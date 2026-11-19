#!/usr/bin/env python3
"""Measures out/Kerbside.app (WKWebView) loading and running City mode.

  python3 measure.py --smoke               40 s: does the page render, does polling work
  python3 measure.py --cold                clear this app's own website data first, then a full run
  python3 measure.py                       a full (warm) run
  options: --seconds N (minimum run, default 300) --after-lobby N (default 90) --interval N (default 2)

Processes: the app is our child. Its WebKit XPC helpers (WebContent, GPU, Networking) are children
of launchd, not of the app, so they are found by the pids the app reads from WebKit (SPI, printed on
stdout) and, as a fallback, as WebKit helpers that did not exist before launch. Memory is
`footprint -p` (phys_footprint, what Activity Monitor calls Memory; no sudo needed for our own
processes) plus RSS from ps; CPU is the delta of ps cumulative CPU time between samples.
"""
import argparse, csv, glob, json, os, re, signal, subprocess, sys, threading, time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "out", "Kerbside.app")
EXE = os.path.join(APP, "Contents", "MacOS", "Kerbside")
BID = "app.kerbside.webkit"
HOME = os.path.expanduser("~")
LIB = os.path.join(HOME, "Library")
#: This app's own data locations (everything that may carry its bundle id); only these are ever cleared.
DATA_GLOBS = [
    f"{LIB}/WebKit/{BID}", f"{LIB}/Caches/{BID}", f"{LIB}/HTTPStorages/{BID}*", f"{LIB}/Containers/{BID}",
    f"{LIB}/Saved Application State/{BID}.savedState", f"{LIB}/Preferences/{BID}.plist", f"{LIB}/Cookies/{BID}*",
    f"{LIB}/Application Support/{BID}",
]
MIN_FREE_KB = 700 * 1024
KINDS = {"com.apple.WebKit.WebContent": "webcontent", "com.apple.WebKit.GPU": "gpu", "com.apple.WebKit.Networking": "networking"}


def du_kb(path):
    try:
        out = subprocess.run(["du", "-sk", path], capture_output=True, text=True).stdout.split()
        return int(out[0]) if out else None
    except Exception:
        return None


def data_dirs():
    found = {}
    for g in DATA_GLOBS:
        for p in glob.glob(g):
            found[p.replace(HOME, "~")] = du_kb(p)
    # Anything else carrying the bundle id in the usual places (shallow; no other app's containers).
    for base in ["WebKit", "Caches", "HTTPStorages", "Application Support", "Saved Application State", "Preferences", "Cookies"]:
        for p in glob.glob(f"{LIB}/{base}/*{BID}*"):
            found.setdefault(p.replace(HOME, "~"), du_kb(p))
    return found


def screen_locked():
    out = subprocess.run(["ioreg", "-n", "Root", "-d1", "-a"], capture_output=True, text=True).stdout
    m = re.search(r"<key>CGSSessionScreenIsLocked</key>\s*<(true|false)/>", out)
    return (m[1] == "true") if m else False


def df_free_kb():
    line = subprocess.run(["df", "-k", "/"], capture_output=True, text=True).stdout.strip().splitlines()[-1].split()
    return int(line[3])


def cputime_s(s):
    # [dd-]hh:mm:ss.ss: a day is twenty-four hours, not sixty.
    days, _, clock = s.rpartition("-")
    t = 0.0
    for x in clock.split(":"):
        t = t * 60 + float(x)
    return t + (float(days) * 86400 if days else 0.0)


def ps_table():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss=,time=,command="], capture_output=True, text=True).stdout
    rows = {}
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)", line)
        if m:
            rows[int(m[1])] = {"ppid": int(m[2]), "rss_kb": int(m[3]), "cpu_s": cputime_s(m[4]), "cmd": m[5]}
    return rows


def webkit_kind(cmd):
    for k, v in KINDS.items():
        if cmd.rstrip().endswith("/" + k) or ("/" + k + " ") in cmd:
            return v
    return None


UNIT = {"B": 1 / 1024, "KB": 1, "MB": 1024, "GB": 1024 * 1024}


def footprints(pids, categories=False):
    if not pids:
        return {}, {}
    cmd = ["/usr/bin/footprint"] + sum([["-p", str(p)] for p in pids], [])
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    fp, cats, cur = {}, {}, None
    for line in out.splitlines():
        m = re.match(r"(\S.*?) \[(\d+)\]: .*Footprint: ([\d.]+) (B|KB|MB|GB)", line)
        if m:
            cur = int(m[2]); fp[cur] = round(float(m[3]) * UNIT[m[4]]); cats[cur] = []
            continue
        if line.startswith("Shared with"):
            cur = None
            continue
        if categories and cur is not None:
            c = re.match(r"\s*([\d.]+) (B|KB|MB|GB)\s+([\d.]+) (B|KB|MB|GB)\s+([\d.]+) (B|KB|MB|GB)\s+(\d+)\s+(.+)", line)
            if c:
                cats[cur].append((round(float(c[1]) * UNIT[c[2]]), c[8].strip()))
    if categories:
        cats = {p: sorted(v, reverse=True)[:8] for p, v in cats.items()}
    return fp, cats


class Run:
    def __init__(self, a):
        self.a = a
        self.lock = threading.Lock()
        self.page = {}        # latest page sample
        self.pids = {}        # kind -> pid reported by the app
        self.events = []
        self.logs = []
        self.api = None
        self.lobby_gone = None
        self.enter_presses = []
        self.terminations = []
        self.first_loaded = None
        self.first_home = None

    def reader(self, stream, jsonl):
        for raw in stream:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            now = time.time() - self.t0
            if not line.startswith("kerbside: "):
                continue
            try:
                o = json.loads(line[10:])
            except Exception:
                continue
            o["rx"] = round(now, 2)
            jsonl.write(json.dumps(o) + "\n"); jsonl.flush()
            k = o.get("kind")
            with self.lock:
                if k == "sample" and "page" in o:
                    self.page = o["page"]
                    if o["page"].get("loaded") and self.first_loaded is None:
                        self.first_loaded = now
                    if o["page"].get("home") and self.first_home is None:
                        self.first_home = now
                elif k == "page-log":
                    self.logs.append(o)
                elif k == "api":
                    self.api = o
                    self.pids.update({kk: int(v) for kk, v in (o.get("pids") or {}).items()})
                elif k == "process":
                    self.pids.update({kk: int(v) for kk, v in (o.get("pids") or {}).items()})
                    self.events.append(o)
                elif k == "enter":
                    if o.get("event") == "lobby-gone" and self.lobby_gone is None:
                        self.lobby_gone = now
                    else:
                        self.enter_presses.append(o)
                elif k == "terminated":
                    self.terminations.append(o)
                else:
                    self.events.append(o)


def phase(p, lobby_gone, t):
    if lobby_gone is not None and t >= lobby_gone:
        return "in the city"
    if p.get("line"):
        return "loadscreen: " + p["line"].strip()
    if p.get("status"):
        return "lobby: " + p["status"].strip()
    if p.get("home"):
        return "lobby"
    return "page starting"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--cold", action="store_true")
    ap.add_argument("--seconds", type=float, default=300)
    ap.add_argument("--after-lobby", type=float, default=90)
    ap.add_argument("--interval", type=float, default=2)
    a = ap.parse_args()
    if a.smoke:
        a.seconds, a.after_lobby = 40, 0
    if subprocess.run(["pgrep", "-f", "Kerbside.app/Contents/MacOS"], capture_output=True).returncode == 0:
        sys.exit("a Kerbside.app is already running; quit it first")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(HERE, f"measure-{stamp}{'-smoke' if a.smoke else ('-cold' if a.cold else '-warm')}")
    os.makedirs(outdir)

    cleared = []
    if a.cold:
        for g in DATA_GLOBS:
            for p in glob.glob(g):
                assert BID in p
                subprocess.run(["rm", "-rf", p]); cleared.append(p.replace(HOME, "~"))
    summary = {"mode": "smoke" if a.smoke else ("cold" if a.cold else "warm"), "cleared": cleared,
               "bundle_kb": du_kb(APP), "electron_bundle": None,
               "data_before_kb": data_dirs(), "df_free_before_kb": df_free_kb(), "interval_s": a.interval, "screen_locked_at_start": screen_locked(),
               "memory_tool": "footprint -p (phys_footprint) + ps rss; cpu from ps cumulative time deltas"}
    for cand in [os.path.join(HERE, "..", "desktop", "out", "Kerbside-darwin-arm64", "Kerbside.app"), "/Applications/Kerbside.app",
                 os.path.join(HOME, "Applications", "Kerbside.app")]:
        if os.path.isdir(cand) and os.path.isdir(os.path.join(cand, "Contents", "Frameworks", "Electron Framework.framework")):
            summary["electron_bundle"] = {"path": cand.replace(HOME, "~"), "kb": du_kb(cand)}
            break

    baseline = {pid for pid, r in ps_table().items() if webkit_kind(r["cmd"])}
    run = Run(a)
    jsonl = open(os.path.join(outdir, "page.jsonl"), "w")
    run.t0 = time.time()
    proc = subprocess.Popen([EXE, "--measure"], stdout=subprocess.PIPE, stderr=open(os.path.join(outdir, "stderr.log"), "w"))
    caff = subprocess.Popen(["caffeinate", "-i", "-d", "-w", str(proc.pid)])
    threading.Thread(target=run.reader, args=(proc.stdout, jsonl), daemon=True).start()

    rows, prev_cpu, ours, stop_reason = [], {}, {}, None
    cats_log = []
    hard_cap = a.seconds + 300
    i = 0
    while True:
        tick = time.time()
        t = tick - run.t0
        table = ps_table()
        with run.lock:
            page = dict(run.page); reported = dict(run.pids); lobby = run.lobby_gone
        # Our processes: the app, what it reported, and WebKit helpers new since launch.
        if proc.pid in table:
            ours[proc.pid] = "app"
        for kind, pid in reported.items():
            kk = {"webContent": "webcontent", "gpu": "gpu", "networking": "networking"}.get(kind, kind)
            if pid in table:
                ours[pid] = kk
        # Fallback for helpers the app cannot name (WebKit exposes no Networking pid): new since
        # launch, and first seen within 15 s of launch (later ones may be another app's).
        reported_kinds = {"webcontent" if k == "webContent" else k for k in reported}
        for pid, r in table.items():
            k = webkit_kind(r["cmd"])
            if k and pid not in baseline and pid not in ours:
                baseline.add(pid)
                if t <= 15 and k not in reported_kinds:
                    ours[pid] = k
        live = [p for p in ours if p in table]
        want_cats = i % 15 == 0
        fp, cats = footprints(live, categories=want_cats)
        if want_cats:
            cats_log.append({"t": round(t, 1), "phase": phase(page, lobby, t),
                             "processes": {f"{ours[p]}:{p}": cats.get(p, []) for p in live}})
        free = df_free_kb()
        row = {"t": round(t, 1), "phase": phase(page, lobby, t), "df_free_kb": free, "screen_locked": screen_locked()}
        tot = {"rss_kb": 0, "fp_kb": 0, "cpu_pct": 0.0}
        for kind in ["app", "webcontent", "gpu", "networking"]:
            ps_ = [p for p in live if ours[p] == kind]
            rss = sum(table[p]["rss_kb"] for p in ps_)
            f = sum(fp.get(p, 0) for p in ps_)
            cpu = 0.0
            for p in ps_:
                c = table[p]["cpu_s"]
                if p in prev_cpu:
                    cpu += max(0.0, c - prev_cpu[p][0]) / max(1e-3, tick - prev_cpu[p][1]) * 100
                prev_cpu[p] = (c, tick)
            row.update({f"{kind}_n": len(ps_), f"{kind}_rss_kb": rss, f"{kind}_fp_kb": f, f"{kind}_cpu_pct": round(cpu, 1)})
            tot["rss_kb"] += rss; tot["fp_kb"] += f; tot["cpu_pct"] += cpu
        row.update({"total_rss_kb": tot["rss_kb"], "total_fp_kb": tot["fp_kb"], "total_cpu_pct": round(tot["cpu_pct"], 1)})
        for k in ["fraction", "loaded", "home", "loadscreen", "line", "status", "people", "vehicles", "geometries", "textures",
                  "calls", "triangles", "programs", "fps", "frameMaxMs", "heapUsed", "hidden"]:
            v = page.get(k)
            row["page_" + k] = v if not isinstance(v, str) else v.strip()[:80]
        row["page_waiting"] = "|".join(page.get("waiting") or [])[:160]
        rows.append(row)
        i += 1
        if free < MIN_FREE_KB:
            stop_reason = f"free disk {free} KB < 700 MB"; break
        if proc.poll() is not None:
            stop_reason = f"app exited ({proc.returncode})"; break
        if a.smoke and t >= a.seconds:
            stop_reason = "smoke time"; break
        if not a.smoke and lobby is not None and t >= max(a.seconds, lobby + a.after_lobby):
            stop_reason = f"run done: {a.seconds:.0f} s and {a.after_lobby:.0f} s in the city"; break
        if t >= hard_cap:
            stop_reason = "hard cap: never got into the city"; break
        time.sleep(max(0.0, a.interval - (time.time() - tick)))

    # Quit, then make sure everything is gone.
    if proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait(5)
    caff.terminate()
    time.sleep(4)
    jsonl.close()
    left = {p: ours[p] for p in ours if p in ps_table()}
    still = subprocess.run(["pgrep", "-f", "Kerbside.app/Contents/MacOS"], capture_output=True, text=True).stdout.strip()

    summary.update({"stop_reason": stop_reason, "samples": len(rows), "duration_s": rows[-1]["t"] if rows else 0,
                    "data_after_kb": data_dirs(), "screen_locked_at_end": screen_locked(), "df_free_after_kb": df_free_kb(),
                    "processes_seen": {str(p): k for p, k in ours.items()}, "helpers_alive_after_quit": {str(p): k for p, k in left.items()},
                    "app_still_running": still or None,
                    "time_first_lobby_s": run.first_home, "time_world_loaded_s": run.first_loaded, "time_in_city_s": run.lobby_gone,
                    "enter_presses": run.enter_presses, "terminations": run.terminations, "api": run.api and run.api.get("apis"),
                    "reported_pids": run.pids, "page_logs": len(run.logs)})
    # Peaks per process kind and in total, with the phase on screen.
    peaks = {}
    for kind in ["app", "webcontent", "gpu", "networking", "total"]:
        col = f"{kind}_fp_kb"
        if not rows:
            continue
        r = max(rows, key=lambda x: x.get(col) or 0)
        city = [x[col] for x in rows if x["phase"] == "in the city" and x.get(col)]
        tail = city[len(city) // 2:] if city else []
        cpu_col = f"{kind}_cpu_pct"
        rc = max(rows, key=lambda x: x.get(cpu_col) or 0)
        peaks[kind] = {"peak_fp_kb": r.get(col), "peak_at_s": r["t"], "peak_phase": r["phase"], "peak_fraction": r.get("page_fraction"),
                       "peak_rss_kb": max(x.get(f"{kind}_rss_kb") or 0 for x in rows),
                       "steady_city_fp_kb_median": sorted(tail)[len(tail) // 2] if tail else None,
                       "steady_city_fp_kb_min_max": [min(tail), max(tail)] if tail else None,
                       "peak_cpu_pct": rc.get(cpu_col), "peak_cpu_at_s": rc["t"], "peak_cpu_phase": rc["phase"],
                       "mean_cpu_pct_loading": avg([x.get(cpu_col) for x in rows if x["phase"] != "in the city"]),
                       "mean_cpu_pct_city": avg([x.get(cpu_col) for x in rows if x["phase"] == "in the city"])}
    summary["peaks"] = peaks
    # Largest jumps in total footprint between consecutive samples.
    jumps = []
    for a_, b_ in zip(rows, rows[1:]):
        jumps.append({"from_s": a_["t"], "to_s": b_["t"], "delta_kb": b_["total_fp_kb"] - a_["total_fp_kb"], "phase": b_["phase"],
                      "fraction": b_.get("page_fraction"),
                      "by_kind_kb": {k: b_[f"{k}_fp_kb"] - a_[f"{k}_fp_kb"] for k in ["app", "webcontent", "gpu", "networking"]}})
    summary["largest_jumps"] = sorted(jumps, key=lambda j: -j["delta_kb"])[:8]
    # Phases: first time each was seen, and memory/cpu while it was on screen.
    ph = {}
    for r in rows:
        p = ph.setdefault(r["phase"], {"first_s": r["t"], "last_s": r["t"], "samples": 0, "max_total_fp_kb": 0, "cpu": []})
        p["last_s"] = r["t"]; p["samples"] += 1; p["max_total_fp_kb"] = max(p["max_total_fp_kb"], r["total_fp_kb"]); p["cpu"].append(r["total_cpu_pct"])
    for p in ph.values():
        p["mean_total_cpu_pct"] = avg(p.pop("cpu"))
    summary["phases"] = ph
    city = [r for r in rows if r["phase"] == "in the city"]
    fps = [r["page_fps"] for r in city if isinstance(r.get("page_fps"), (int, float))]
    summary["city_fps"] = {"samples": len(fps), "median": med(fps), "min": min(fps) if fps else None, "max": max(fps) if fps else None,
                           "frame_max_ms_median": med([r["page_frameMaxMs"] for r in city if isinstance(r.get("page_frameMaxMs"), (int, float))])}
    last = city[-1] if city else (rows[-1] if rows else {})
    summary["city_last_sample"] = {k: last.get(k) for k in last if k.startswith("page_")}
    summary["memory_categories"] = cats_log
    levels = {}
    for l in run.logs:
        levels[l.get("level")] = levels.get(l.get("level"), 0) + 1
    summary["page_log_levels"] = levels
    uniq = {}
    for l in run.logs:
        key = (l.get("level"), (l.get("text") or "")[:160])
        uniq[key] = uniq.get(key, 0) + 1
    summary["page_log_unique"] = [{"level": k[0], "text": k[1], "count": n} for k, n in sorted(uniq.items(), key=lambda kv: -kv[1])][:40]

    with open(os.path.join(outdir, "timeline.csv"), "w", newline="") as f:
        keys = list(rows[0].keys()) if rows else []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
    with open(os.path.join(outdir, "summary.json"), "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print(json.dumps({"outdir": outdir, "stop_reason": stop_reason, "samples": len(rows), "in_city_s": run.lobby_gone,
                      "app_still_running": still or None, "helpers_alive_after_quit": left}))


def avg(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(sum(xs) / len(xs), 1) if xs else None


def med(xs):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    return xs[len(xs) // 2] if xs else None


if __name__ == "__main__":
    main()
