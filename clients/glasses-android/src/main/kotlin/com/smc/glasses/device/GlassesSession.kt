package com.smc.glasses.device

import com.smc.glasses.capture.CaptureContext
import com.smc.glasses.capture.CaptureDecision
import com.smc.glasses.capture.TriggerEngine

/**
 * The camera source, abstracted over real glasses and the Mock Device Kit.
 *
 * The Wearables Device Access Toolkit ships a Mock Device Kit that simulates camera streaming,
 * photo capture, permissions and device state, and — the part that matters here — accepts an
 * H.265 file as the simulated feed. Meta's own guarantee is that app code behaves identically
 * against a mock device and a real one, so this interface exists to make that guarantee usable
 * rather than to paper over a difference.
 *
 * That is what closes the loop with the simulator: CARLA renders a drive, the drive is encoded
 * to H.265, and the Mock Device Kit replays it as the glasses camera. The same synthetic scene
 * with the same exact ground truth exercises the vehicle path and the glasses path, with no
 * hardware and no field time.
 */
interface CameraSource {
    val isMock: Boolean
    fun start(onFrame: (Frame) -> Unit)
    fun stop()
}

data class Frame(
    val timestampMs: Long,
    val widthPx: Int,
    val heightPx: Int,
    /** Focal length in pixels. Required by every metric-depth conversion downstream. */
    val focalPx: Double,
    val bytes: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is Frame && timestampMs == other.timestampMs && bytes.contentEquals(other.bytes)

    override fun hashCode(): Int = 31 * timestampMs.hashCode() + bytes.contentHashCode()
}

/**
 * Real glasses, via the Device Access Toolkit.
 *
 * Kept thin on purpose. The toolkit is in developer preview and publishing is gated — general
 * availability is targeted for 2026 — so the surface this depends on is the surface most likely
 * to move. Everything of substance lives behind [CameraSource] where the toolkit cannot reach it.
 */
class WearablesCameraSource(private val appId: String) : CameraSource {
    override val isMock = false

    override fun start(onFrame: (Frame) -> Unit) {
        throw NotImplementedError(
            "bind to the Meta Wearables DAT camera stream here; see " +
                "github.com/facebook/meta-wearables-dat-android and set META_WEARABLES_APP_ID"
        )
    }

    override fun stop() = Unit
}

/**
 * Mock Device Kit source, fed an H.265 file — normally a CARLA render.
 *
 * Android requires the file to be transcoded to H.265 with FFmpeg first; the iOS sample app
 * converts automatically. The pairing, power and wearing-state toggles are driven through the
 * kit's debug menu.
 */
class MockCameraSource(private val h265Path: String) : CameraSource {
    override val isMock = true

    override fun start(onFrame: (Frame) -> Unit) {
        throw NotImplementedError(
            "pair a mock device via the CameraAccess sample app's debug menu and point it at " +
                h265Path
        )
    }

    override fun stop() = Unit
}

/**
 * Ties the camera to the trigger and hands surviving frames to the upload queue.
 *
 * Every frame the camera produces is evaluated; only the survivors are encoded and uploaded.
 * The asymmetry is the whole design: evaluation must be nearly free, so scene comparison uses a
 * perceptual hash rather than a learned embedding, and the embedding comparison that actually
 * matters happens in the cloud on frames that already earned their upload.
 */
class CaptureSession(
    private val camera: CameraSource,
    private val trigger: TriggerEngine,
    private val onAccepted: (Frame, CaptureDecision) -> Unit,
    private val contextProvider: (Long) -> CaptureContext,
) {
    fun start() {
        camera.start { frame ->
            val decision = trigger.evaluate(contextProvider(frame.timestampMs))
            if (decision.capture) onAccepted(frame, decision)
        }
    }

    fun stop() = camera.stop()

    /** Suppression counts, for the field diagnostic and for coverage accounting. */
    fun diagnostics(): Map<String, Int> =
        trigger.reasonHistogram.mapKeys { it.key.name } + ("captured" to trigger.capturedCount)
}
