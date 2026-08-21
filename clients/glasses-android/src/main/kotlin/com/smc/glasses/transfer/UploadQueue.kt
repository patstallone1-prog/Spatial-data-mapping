package com.smc.glasses.transfer

import com.smc.glasses.device.Frame

/**
 * Layer B — getting frames off the device.
 *
 * No codec is written here. Stills go through the platform AVIF/WebP encoder and bursts through
 * the hardware HEVC encoder; both run on dedicated silicon and are effectively free in battery
 * terms. Anything hand-rolled would be slower, hotter, and worse.
 *
 * Three policies do the real work:
 *
 *  - **Redact before the frame ever leaves the device.** EgoBlur is Apache 2.0, purpose-built
 *    for egocentric imagery, and detects faces and licence plates. The re-spec defers privacy;
 *    deferring it here would be a choice to upload unredacted bystanders for the sake of an
 *    integration that costs a day. It runs on-device, before the upload queue.
 *  - **Never block capture on the network.** Frames are journalled to disk on capture and
 *    uploaded by a separate worker. A wearer walks through dead zones constantly, and a
 *    capture path that awaits an HTTP response drops exactly the novel cells that are worth
 *    the most.
 *  - **Spend the metered link on the most valuable frames first.** Upload order follows cell
 *    priority, so a corridor a partner is paying for drains before an already-dense one.
 */
enum class UploadState { PENDING, REDACTED, UPLOADING, DONE, FAILED }

data class QueuedFrame(
    val frameId: String,
    val capturedAtMs: Long,
    val cellId: String,
    val priority: Double,
    val sizeBytes: Long,
    val state: UploadState = UploadState.PENDING,
    val attempts: Int = 0,
)

data class TransferPolicy(
    val wifiOnly: Boolean = true,
    val maxCellularMbPerDay: Long = 0,
    val maxAttempts: Int = 6,
    /** Journalled frames older than this are dropped unuploaded rather than filling storage. */
    val maxJournalAgeMs: Long = 14L * 24 * 3600 * 1000,
    val maxJournalBytes: Long = 4L * 1024 * 1024 * 1024,
)

interface Redactor {
    /** Blur faces and licence plates in place. Runs before anything is queued. */
    fun redact(frame: Frame): Frame
}

interface BlobUploader {
    /** Resumable, idempotent by frameId. Must tolerate being called twice with the same id. */
    suspend fun upload(frameId: String, bytes: ByteArray): Boolean
}

/**
 * Ordered, bounded upload journal.
 *
 * Ordering is by cell priority then age. Bounded because a wearer with a week of dead zones
 * would otherwise fill the device; when the bound is hit the *lowest-priority oldest* frames
 * are dropped, never the newest, because a novel cell captured five minutes ago is worth more
 * than a redundant one from last Tuesday.
 */
class UploadQueue(
    private val policy: TransferPolicy = TransferPolicy(),
    private val redactor: Redactor,
    private val uploader: BlobUploader,
) {
    private val journal = mutableListOf<QueuedFrame>()

    val depth: Int get() = journal.size
    val queuedBytes: Long get() = journal.sumOf { it.sizeBytes }

    fun enqueue(frame: Frame, frameId: String, cellId: String, priority: Double): QueuedFrame {
        val redacted = redactor.redact(frame)
        val entry = QueuedFrame(
            frameId = frameId,
            capturedAtMs = redacted.timestampMs,
            cellId = cellId,
            priority = priority,
            sizeBytes = redacted.bytes.size.toLong(),
            state = UploadState.REDACTED,
        )
        journal.add(entry)
        evictIfOverBudget()
        return entry
    }

    /** Highest priority first, then oldest — the order the metered link should be spent in. */
    fun nextBatch(limit: Int): List<QueuedFrame> =
        journal.asSequence()
            .filter { it.state == UploadState.REDACTED || it.state == UploadState.FAILED }
            .filter { it.attempts < policy.maxAttempts }
            .sortedWith(compareByDescending<QueuedFrame> { it.priority }.thenBy { it.capturedAtMs })
            .take(limit)
            .toList()

    private fun evictIfOverBudget() {
        val now = journal.maxOfOrNull { it.capturedAtMs } ?: return
        journal.removeAll { now - it.capturedAtMs > policy.maxJournalAgeMs }
        while (queuedBytes > policy.maxJournalBytes && journal.isNotEmpty()) {
            val victim = journal.minWithOrNull(
                compareBy<QueuedFrame> { it.priority }.thenBy { it.capturedAtMs }
            ) ?: break
            journal.remove(victim)
        }
    }
}
