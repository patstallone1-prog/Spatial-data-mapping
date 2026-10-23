"""Local execution of exactly the same leased jobs used by an HTTP cloud worker."""
from __future__ import annotations


class LocalQueueTransport:
    def __init__(self, queue, worker_id: str, ready=lambda: True):
        self.queue, self.worker_id, self.ready = queue, worker_id, ready

    def lease(self, resources, ttl):
        return self.queue.lease(self.worker_id, resources, ttl) if self.ready() else None

    def heartbeat(self, job, token, ttl):
        return self.queue.heartbeat(job, self.worker_id, token, ttl)

    def complete(self, job, token, output, metrics):
        return self.queue.complete(job, self.worker_id, token, output, metrics)

    def fail(self, job, token, error, metrics, permanent):
        return self.queue.fail(job, self.worker_id, token, error, metrics=metrics, permanent=permanent)

    def release(self, job, token, reason):
        return self.queue.release(job, self.worker_id, token, reason)

    def goodbye(self, reason):
        return None

    def stored(self, nbytes):
        return None  # Local disk: no cloud-storage charge.
