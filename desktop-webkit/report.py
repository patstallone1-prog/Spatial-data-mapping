#!/usr/bin/env python3
"""Writes REPORT.md (the measured part) for a measure-* directory: python3 report.py <dir> [notes.md]

Everything here comes from summary.json and timeline.csv. A notes file, if given, is appended
as the hand-written reading of the numbers."""
import csv, json, os, sys

d = sys.argv[1]
S = json.load(open(os.path.join(d, "summary.json")))
R = list(csv.DictReader(open(os.path.join(d, "timeline.csv"))))
K = ["app", "webcontent", "gpu", "networking"]


def mb(kb):
    return "n/a" if kb in (None, "") else f"{float(kb) / 1024:,.0f} MB"


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


L = []
w = L.append
w(f"# Kerbside on WebKit: {S['mode']} run, {os.path.basename(d)}\n")
w(f"Samples: {S['samples']} every {S['interval_s']} s over {S['duration_s']} s. Stopped: {S['stop_reason']}. "
  f"Memory: {S['memory_tool']}. Screen locked at start/end: {S.get('screen_locked_at_start')}/{S.get('screen_locked_at_end')}.\n")

w("## Disk\n")
e = S.get("electron_bundle")
w(f"- WebKit Kerbside.app: **{S['bundle_kb']} KB** ({S['bundle_kb'] / 1024:.2f} MB).")
w(f"- Electron Kerbside.app: " + (f"{e['kb'] / 1024:,.0f} MB at {e['path']}" if e else "not found") + ".")
if S.get("cleared"):
    w(f"- Cleared before the run (this app's own data only): {', '.join(S['cleared'])}.")
before, after = S["data_before_kb"], S["data_after_kb"]
w("\n| website data location | before | after | growth |\n|---|---:|---:|---:|")
for p in sorted(set(before) | set(after)):
    b, a = before.get(p), after.get(p)
    w(f"| {p} | {b if b is not None else '-'} KB | {a if a is not None else '-'} KB | {(a or 0) - (b or 0):+,} KB |")
tb, ta = sum(v or 0 for v in before.values()), sum(v or 0 for v in after.values())
w(f"| **total** | {tb:,} KB | {ta:,} KB | {ta - tb:+,} KB |")
w(f"\nFree disk on /: {S['df_free_before_kb'] / 1024:,.0f} MB before, {S['df_free_after_kb'] / 1024:,.0f} MB after "
  f"(min during run {min(int(r['df_free_kb']) for r in R) / 1024:,.0f} MB; swap and other processes count here too).\n")

w("## Load times\n")
w(f"- Lobby (`#home`) first seen: {S['time_first_lobby_s']} s after launch.")
w(f"- World loaded (`kerbsideLoadState().loaded`): {S['time_world_loaded_s']} s.")
w(f"- In the city (lobby gone): {S['time_in_city_s']} s.")
w(f"- Enter presses: " + "; ".join(f"#{p['press']} at {p['seconds']:.1f} s (loaded={p['loaded']})" for p in S["enter_presses"]) + ".")
w(f"- Web content process terminations: {len(S['terminations'])}" + (f" ({S['terminations']})" if S["terminations"] else "") + ".")
w(f"- Helpers alive after quit: {S['helpers_alive_after_quit'] or 'none'}; app still running: {S['app_still_running'] or 'no'}.\n")

w("## Memory per process (phys_footprint)\n")
w("| process | peak footprint | at | on screen then | load fraction | peak RSS | steady in city (median, 2nd half) | city range |")
w("|---|---:|---:|---|---:|---:|---:|---|")
for k in K + ["total"]:
    p = S["peaks"].get(k)
    if not p:
        continue
    rng = p["steady_city_fp_kb_min_max"]
    w(f"| {k} | {mb(p['peak_fp_kb'])} | {p['peak_at_s']} s | {p['peak_phase']} | {p['peak_fraction']} | {mb(p['peak_rss_kb'])} | "
      f"{mb(p['steady_city_fp_kb_median'])} | {(mb(rng[0]) + ' - ' + mb(rng[1])) if rng else 'n/a'} |")
w("\nProcesses seen: " + ", ".join(f"{k} {p}" for p, k in S["processes_seen"].items()) + ".\n")

w("### Largest jumps in total footprint (one 2 s sample to the next)\n")
w("| from | to | total | webcontent | gpu | networking | app | on screen | fraction |\n|---:|---:|---:|---:|---:|---:|---:|---|---:|")
for j in S["largest_jumps"]:
    b = j["by_kind_kb"]
    w(f"| {j['from_s']} | {j['to_s']} | {j['delta_kb'] / 1024:+,.0f} MB | {b['webcontent'] / 1024:+,.0f} | {b['gpu'] / 1024:+,.0f} | "
      f"{b['networking'] / 1024:+,.0f} | {b['app'] / 1024:+,.0f} | {j['phase']} | {j['fraction']} |")

w("\n### Where the memory was (footprint categories, largest dirty first)\n")
peak_t = S["peaks"]["webcontent"]["peak_at_s"]
cats = S.get("memory_categories") or []
pick = []
if cats:
    pick.append(min(cats, key=lambda c: abs(c["t"] - peak_t)))
    if cats[-1] not in pick:
        pick.append(cats[-1])
for c in pick:
    w(f"At {c['t']} s ({c['phase']}):\n")
    for proc, items in c["processes"].items():
        if proc.split(":")[0] in ("webcontent", "gpu"):
            w(f"- {proc}: " + ", ".join(f"{name} {kb / 1024:,.0f} MB" for kb, name in items[:6]))
    w("")

w("## Phases (what the page's load screen said) and what they cost\n")
w("| phase | first seen | last seen | samples | max total footprint | mean total CPU |\n|---|---:|---:|---:|---:|---:|")
for name, p in sorted(S["phases"].items(), key=lambda kv: kv[1]["first_s"]):
    w(f"| {name} | {p['first_s']} s | {p['last_s']} s | {p['samples']} | {mb(p['max_total_fp_kb'])} | {p['mean_total_cpu_pct']}% |")

w("\n## CPU (% of one core; 100% = one core busy)\n")
w("| process | mean while loading | mean in the city | peak | peak at | on screen then |\n|---|---:|---:|---:|---:|---|")
for k in K + ["total"]:
    p = S["peaks"].get(k)
    if p:
        w(f"| {k} | {p['mean_cpu_pct_loading']} | {p['mean_cpu_pct_city']} | {p['peak_cpu_pct']} | {p['peak_cpu_at_s']} s | {p['peak_cpu_phase']} |")

w("\n## Timeline, every ~10 s\n")
w("| t | on screen | fraction | webcontent | gpu | net | total CPU | fps | worst frame | draw calls | triangles | geometries | textures | people | vehicles |")
w("|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
nxt = 0
for r in R:
    t = float(r["t"])
    if t + 0.01 < nxt and r is not R[-1]:
        continue
    nxt = t + 10
    w(f"| {r['t']} | {r['phase'][:60]} | {r['page_fraction']} | {mb(r['webcontent_fp_kb'])} | {mb(r['gpu_fp_kb'])} | {mb(r['networking_fp_kb'])} | "
      f"{r['total_cpu_pct']} | {r['page_fps']} | {r['page_frameMaxMs']} | {r['page_calls']} | {r['page_triangles']} | {r['page_geometries']} | "
      f"{r['page_textures']} | {r['page_people']} | {r['page_vehicles']} |")

f = S["city_fps"]
w(f"\n## Frame rate in the city\n\nrequestAnimationFrame counted in the page over 1 s windows, read each second: median **{f['median']}** fps, "
  f"min {f['min']}, max {f['max']} over {f['samples']} samples; median worst frame in a window {f['frame_max_ms_median']} ms.")
last = S["city_last_sample"]
w("Last city sample: " + ", ".join(f"{k[5:]}={v}" for k, v in last.items() if v not in ("", None)) + ".\n")

w("## Console errors and warnings forwarded by the page\n")
w(f"Counts by level: {S['page_log_levels'] or 'none'}.\n")
for u in S["page_log_unique"][:25]:
    w(f"- [{u['level']}] x{u['count']}: `{u['text'][:150].replace('`', '')}`")

w("\n## APIs (probed once in the page)\n")
api = S.get("api") or {}
w("| API | value |\n|---|---|")
for k, v in api.items():
    w(f"| {k} | {json.dumps(v)} |")

notes = sys.argv[2] if len(sys.argv) > 2 else None
if notes:
    w("\n" + open(notes).read())
open(os.path.join(d, "REPORT.md"), "w").write("\n".join(L) + "\n")
print(os.path.join(d, "REPORT.md"))
