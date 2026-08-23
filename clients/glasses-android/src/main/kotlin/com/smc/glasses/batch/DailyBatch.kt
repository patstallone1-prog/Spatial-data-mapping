package com.smc.glasses.batch

import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * The once-a-day upload.
 *
 * Continuous streaming was rejected deliberately, and not only to save data. A radio kept warm
 * all day is the single largest battery cost in a passive capture app, and a wearer whose phone
 * dies by four in the afternoon stops contributing entirely — so an always-on uploader collects
 * *less* data than one that sleeps. Batching also lets curation see the whole day at once, which
 * is the only way duplicate and quota decisions can be made correctly.
 *
 * The window is 02:00 local. Nothing about that hour is magic; what matters is that it is
 * usually the intersection of charging, Wi-Fi, and nobody waiting on the phone. The constraints
 * below encode that intention properly, so a phone that is awake and on cellular at 2am simply
 * defers rather than spending the user's data.
 *
 * Order is load-bearing:
 *
 *  1. **Assess and reject.** Rejected frames are deleted immediately, not at send time — a day
 *     of capture will fill a phone otherwise.
 *  2. **Compress what survives.** Hardware AVIF/HEIC. This is the expensive step and it runs
 *     once, on the curated set, not on everything captured.
 *  3. **Upload.** Resumable, idempotent by content hash.
 *  4. **Delete only what the server acknowledged.** Never delete on "upload finished"; delete on
 *     "the server says it has it". The gap between those two is where data is lost for good,
 *     because the phone is the only copy.
 */
data class BatchPolicy(
    val hourOfDay: Int = 2,
    val minuteOfHour: Int = 0,
    /** Defer rather than spend cellular data. */
    val requireUnmetered: Boolean = true,
    val requireCharging: Boolean = true,
    val requireBatteryNotLow: Boolean = true,
    /** Ceiling on one night's send. Beyond this the curator trims and the rest waits a day. */
    val maxBatchMegabytes: Double = 250.0,
    /** Frames older than this are dropped unsent; a stale capture is not worth the storage. */
    val maxJournalAgeDays: Int = 7,
    /** Give up on a frame after this many failed nights. */
    val maxAttempts: Int = 5,
)

enum class BatchOutcome {
    /** Nothing to send. */
    EMPTY,

    /** Everything acknowledged and deleted locally. */
    COMPLETE,

    /** Some frames sent; the rest carry to tomorrow. */
    PARTIAL,

    /** Constraints not met — no charger, or metered connection. Retries tonight. */
    DEFERRED,

    FAILED,
}

data class BatchReport(
    val outcome: BatchOutcome,
    val assessed: Int = 0,
    val rejected: Int = 0,
    val compressed: Int = 0,
    val uploaded: Int = 0,
    val acknowledged: Int = 0,
    val deleted: Int = 0,
    val bytesSent: Long = 0,
    val bytesReclaimed: Long = 0,
    val message: String = "",
) {
    val keepRate: Double
        get() = if (assessed == 0) 0.0 else (assessed - rejected).toDouble() / assessed
}

/** Milliseconds from [nowMs] until the next scheduled window. */
fun millisUntilNextWindow(nowMs: Long, policy: BatchPolicy = BatchPolicy()): Long {
    val calendar = Calendar.getInstance().apply {
        timeInMillis = nowMs
        set(Calendar.HOUR_OF_DAY, policy.hourOfDay)
        set(Calendar.MINUTE, policy.minuteOfHour)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }
    if (calendar.timeInMillis <= nowMs) {
        calendar.add(Calendar.DAY_OF_YEAR, 1)
    }
    return calendar.timeInMillis - nowMs
}

interface Assessor {
    /** Sharpness, hash and a keep/drop verdict for the whole batch at once. */
    fun assess(entries: List<JournalEntry>, journal: PhotoJournal): List<JournalEntry>
}

interface Compressor {
    /** Re-encode through the platform hardware encoder. Returns the new byte count. */
    fun compress(entry: JournalEntry, bytes: ByteArray): Pair<ByteArray, Long>
}

interface BatchUploader {
    /** Send one frame. Returns true only when the server has acknowledged receipt. */
    suspend fun send(entry: JournalEntry, bytes: ByteArray): Boolean
}

/**
 * Runs the nightly batch. Platform-free so it can be tested without a device.
 */
class DailyBatchRunner(
    private val journal: PhotoJournal,
    private val assessor: Assessor,
    private val compressor: Compressor,
    private val uploader: BatchUploader,
    private val policy: BatchPolicy = BatchPolicy(),
) {
    suspend fun run(nowMs: Long, constraintsMet: Boolean): BatchReport {
        if (!constraintsMet) {
            return BatchReport(
                BatchOutcome.DEFERRED,
                message = "waiting for charger and unmetered connection",
            )
        }

        // Expire before anything else: stale frames should not consume the assessment pass, the
        // compression budget, or a place in the batch.
        val cutoff = nowMs - TimeUnit.DAYS.toMillis(policy.maxJournalAgeDays.toLong())
        val stale = journal.entries().filter { it.capturedAtMs < cutoff }.map { it.frameId }
        val reclaimedFromStale = if (stale.isEmpty()) 0L else journal.totalBytes()
        journal.purge(stale)

        val captured = journal.entries(EntryState.CAPTURED)
        if (captured.isEmpty()) {
            return BatchReport(BatchOutcome.EMPTY, deleted = stale.size, message = "nothing new")
        }

        // 1. Assess, then delete rejects at once rather than holding them until send time.
        val judged = assessor.assess(captured, journal)
        val rejected = judged.filter { it.state == EntryState.REJECTED }
        journal.purge(rejected.map { it.frameId })
        val kept = judged.filter { it.state == EntryState.KEPT }

        // 2. Compress only the survivors.
        var compressedCount = 0
        for (entry in kept) {
            val (bytes, size) = compressor.compress(entry, journal.read(entry.frameId))
            journal.add(entry.copy(state = EntryState.COMPRESSED, compressedBytes = size), bytes)
            compressedCount++
        }

        // 3. Send, newest first — fresh coverage is worth more than a backlog.
        var sent = 0
        var acked = 0
        var bytesSent = 0L
        val budgetBytes = (policy.maxBatchMegabytes * 1_000_000).toLong()
        val ready = journal.entries(EntryState.COMPRESSED).sortedByDescending { it.capturedAtMs }

        for (entry in ready) {
            val size = entry.compressedBytes ?: entry.sourceBytes
            if (bytesSent + size > budgetBytes) break
            sent++
            if (uploader.send(entry, journal.read(entry.frameId))) {
                journal.update(entry.copy(state = EntryState.ACKNOWLEDGED))
                acked++
                bytesSent += size
            }
        }

        // 4. Delete only what was acknowledged. The phone is the only copy until then.
        val acknowledged = journal.entries(EntryState.ACKNOWLEDGED).map { it.frameId }
        val bytesBefore = journal.totalBytes()
        val deleted = journal.purge(acknowledged)
        val reclaimed = bytesBefore - journal.totalBytes() + reclaimedFromStale

        val remaining = journal.entries(EntryState.COMPRESSED).size
        return BatchReport(
            outcome = if (remaining == 0) BatchOutcome.COMPLETE else BatchOutcome.PARTIAL,
            assessed = judged.size,
            rejected = rejected.size,
            compressed = compressedCount,
            uploaded = sent,
            acknowledged = acked,
            deleted = deleted + stale.size,
            bytesSent = bytesSent,
            bytesReclaimed = reclaimed,
            message = if (remaining == 0) "batch complete" else "$remaining frames carried over",
        )
    }
}
