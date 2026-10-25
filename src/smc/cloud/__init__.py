"""Kerbside in the cloud: a durable queue, workers that come and go, and gated publication.

The local pipeline (``scripts/ingest_region.py`` and friends) is the unit of work; nothing here
re-implements a stage. This package decides what runs where, keeps every input and output in
object storage so no step depends on one machine, and publishes only what passed its gates:

* :mod:`.queue`       -- jobs, leases, heartbeats, retries, quarantine, the cost ledger (SQLite)
* :mod:`.stages`      -- each existing stage: its command, CPU or GPU, its inputs and limits
* :mod:`.plan`        -- the regional registry and gap plan as jobs with dependencies
* :mod:`.store`       -- object storage: a local folder (tests, offline) or Cloudflare R2
* :mod:`.checkpoint`  -- content-addressed trees: a cell's folder after each stage
* :mod:`.gate`        -- the Marina parity audit on a finished cell: pass, or hold for review
* :mod:`.publish`     -- incremental, immutable, verified releases with rollback
* :mod:`.providers`   -- Hetzner (CPU) and RunPod (GPU) instances, and a fake for tests
* :mod:`.budget`      -- spend so far, projected spend, and the hard stop
* :mod:`.scheduler`   -- start workers when there is work, stop them when idle
* :mod:`.worker`      -- lease, restore, run, heartbeat, save, report
* :mod:`.controller`  -- the HTTP API workers and the dashboard talk to
"""

#: Sent on every call to the controller. RunPod's proxy sits behind Cloudflare, which refuses
#: Python's default ``Python-urllib/x`` agent (error 1010) before the controller sees it.
USER_AGENT = "kerbside-cloud/1 (+https://github.com/patstallone1-prog/Spatial-data-mapping)"
