"""Marina-first interior jobs, locally now and on the existing cloud workers later.

Compute and the durable SQLite queue stay local. Only finished batches and logs are
checkpointed to HP700's content-addressed store. A disconnect cannot corrupt the local
batch: checkpointing fails and the lease is retried after the verified volume returns.
No pruning, deletion, git writes, automatic promotion or paid cloud instances.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import plistlib
import signal
import subprocess
import threading
import time
from dataclasses import asdict
from pathlib import Path

from run_interior_engine import BATCH, REGIONS, eligible

from smc.cloud.local import LocalQueueTransport
from smc.cloud.queue import Queue
from smc.cloud.stages import local_interior_batch
from smc.cloud.store import LocalStore
from smc.cloud.worker import Worker

ROOT = Path(__file__).resolve().parents[1]


def revision(root: Path = ROOT) -> str:
    digest = hashlib.sha256()
    paths = [root / 'scripts/build_inferred_interiors.py', root / 'scripts/export_interior_envelopes.mjs',
             root / 'scripts/run_interior_engine.py', *sorted((root / 'src/smc/interiors').rglob('*.py'))]
    for path in paths:
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def jobs(rev: str):
    priority = 0
    for region in REGIONS:  # Corridor first, Marina at its head; all other regions follow.
        rows = eligible(region, max_area=500)
        rows.sort(key=lambda r: r.get('priority_area') != 'Marina')
        for i in range(0, len(rows), BATCH):
            digest = hashlib.sha256(json.dumps(rows[i:i+BATCH], sort_keys=True).encode()).hexdigest()[:16]
            yield local_interior_batch(region, i // BATCH, rev, digest, priority)
            priority += 1


def volume_ok(volume: Path, uuid: str) -> bool:
    if not os.path.ismount(volume):
        return False
    try:
        result = subprocess.run(['diskutil', 'info', '-plist', str(volume)],
                                capture_output=True, timeout=10)
        return result.returncode == 0 and plistlib.loads(result.stdout).get('VolumeUUID') == uuid
    except (OSError, ValueError, subprocess.TimeoutExpired, plistlib.InvalidFileException):
        return False


def battery_ok() -> bool:
    try:
        result = subprocess.run(['pmset', '-g', 'batt'], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False
    import re
    m = re.search(r'(\d+)%', result.stdout)
    return 'AC Power' in result.stdout or (m is not None and int(m[1]) > 30)


class VolumeStore(LocalStore):
    """Never create a phantom HP700 directory on the system drive after an eject."""
    def __init__(self, volume: Path, uuid: str):
        self.volume, self.uuid = volume, uuid
        self.device = volume.stat().st_dev
        super().__init__(volume / 'Kerbside/interior-checkpoints')

    def _path(self, key):
        if not os.path.ismount(self.volume):
            raise OSError('HP700 disconnected; local output is retained')
        if self.volume.stat().st_dev != self.device:
            if not volume_ok(self.volume, self.uuid):
                raise OSError('wrong checkpoint volume')
            self.device = self.volume.stat().st_dev
        return super()._path(key)

    def delete(self, key):
        raise PermissionError('HP700 checkpoint deletion is disabled')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--volume', type=Path, required=True)
    parser.add_argument('--volume-uuid', required=True)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--plan-only', action='store_true')
    parser.add_argument('--export-plan', type=Path, help='portable JobSpec JSON for the existing cloud queue')
    args = parser.parse_args()
    rev = revision()
    specs = list(jobs(rev))
    if args.export_plan:
        args.export_plan.parent.mkdir(parents=True, exist_ok=True)
        args.export_plan.write_text(json.dumps({'schema':'kerbside.cloud.jobs/1', 'revision':rev,
                                               'jobs':[asdict(s) for s in specs]}, indent=1)+'\n')
    if args.plan_only:
        print(json.dumps({'revision':rev, 'batches':len(specs), 'first':[s.__dict__ for s in specs[:2]]}, indent=1))
        return
    state = ROOT / 'build/interior-production'
    state.mkdir(parents=True, exist_ok=True)
    with open(state / 'runner.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not volume_ok(args.volume, args.volume_uuid):
            raise SystemExit('verified HP700 required before creating the checkpoint store')
        queue = Queue(state / 'jobs.sqlite')
        for spec in specs:
            queue.submit(spec)
        checkpoint = args.volume / 'Kerbside/interior-checkpoints'
        store = VolumeStore(args.volume, args.volume_uuid)
        def ready():
            return volume_ok(args.volume, args.volume_uuid) and battery_ok()
        transport = LocalQueueTransport(queue, 'mac-interiors', ready)
        worker = Worker(transport, store, ROOT, worker_id='mac-interiors', resources=['cpu'],
                        slots=args.workers, idle_exit_s=7*86400, poll_s=10, logs=state/'logs')
        stopped = threading.Event()
        def stop(*_):
            worker.stopping.set()
            stopped.set()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        thread = threading.Thread(target=worker.run, daemon=True)
        thread.start()
        while not stopped.is_set() and thread.is_alive():
            queue.reap_expired()
            for spec in jobs(rev):
                queue.submit(spec)  # New eligible houses are picked up without restarting.
            mounted = volume_ok(args.volume, args.volume_uuid)
            status = {'at':time.time(), 'pid':os.getpid(), 'revision':rev, 'queue':queue.counts(),
                      'checkpoint_volume_ready':mounted, 'battery_ready':battery_ok(),
                      'policy':'Marina, remaining SF corridor, then every mapped region; watch for new work',
                      'checkpoint_root':str(checkpoint), 'local_outputs':str(state/rev),
                      'deletion_enabled':False, 'promotion':'accepted houses require release review'}
            temp = state / 'status.tmp'
            temp.write_text(json.dumps(status, indent=1)+'\n')
            temp.replace(state/'status.json')
            stopped.wait(60)
        worker.stopping.set()
        thread.join(timeout=60)


if __name__ == '__main__':
    main()
