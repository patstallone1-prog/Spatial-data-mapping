package com.smc.glasses.batch

/**
 * The on-device photo journal: everything captured since the last successful send.
 *
 * The journal exists because the phone is the only place the whole day's capture is visible at
 * once, and curation needs that. A decision like "this is a near-duplicate of a sharper frame"
 * or "this cell already has twelve views" cannot be made frame by frame as they arrive; it needs
 * the batch. So frames land here, unjudged, and are assessed together before the daily send.
 *
 * Entries are keyed by content hash, so a glasses re-transfer or an app restart mid-copy cannot
 * produce two journal rows for one photograph — which would otherwise inflate a cell's count and
 * push out a genuinely new view.
 */
data class JournalEntry(
    val frameId: String,
    val capturedAtMs: Long,
    val cellId: String,
    val latitude: Double,
    val longitude: Double,
    val positionSigmaM: Double,
    val widthPx: Int,
    val heightPx: Int,
    val sourceBytes: Long,
    val state: EntryState = EntryState.CAPTURED,
    /** Populated by the curation pass. */
    val sharpness: Double? = null,
    val perceptualHash: Long? = null,
    val verdict: String? = null,
    val compressedBytes: Long? = null,
)

enum class EntryState {
    /** Copied from the glasses, not yet judged. */
    CAPTURED,

    /** Assessed and kept. Awaiting compression. */
    KEPT,

    /** Assessed and rejected. Safe to delete immediately, before the daily window. */
    REJECTED,

    /** Re-encoded and ready for the batch. */
    COMPRESSED,

    /** The server has acknowledged this frame. Only now may the local copy go. */
    ACKNOWLEDGED,
}

/**
 * Journal store.
 *
 * Rejected frames are deleted as soon as they are judged rather than at send time. A wearer can
 * fill a phone in an afternoon, and holding frames already known to be worthless until 2am is
 * the difference between a full disk and a working one.
 */
interface PhotoJournal {
    fun add(entry: JournalEntry, bytes: ByteArray): JournalEntry
    fun read(frameId: String): ByteArray
    fun entries(state: EntryState? = null): List<JournalEntry>
    fun update(entry: JournalEntry): JournalEntry

    /** Remove pixels and the row. Used for rejects and for acknowledged frames. */
    fun purge(frameIds: List<String>): Int

    fun totalBytes(): Long
    fun oldestCaptureMs(): Long?
}
