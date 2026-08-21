package com.smc.glasses.capture

/**
 * Motion state, taken straight from Android's Activity Recognition Transition API.
 *
 * Not reimplemented: the platform classifier is tuned, batched, and runs on the sensor hub.
 * A hand-rolled accelerometer classifier would be less accurate and would keep the main CPU
 * awake, which on glasses is the difference between all-day capture and two hours of it.
 */
enum class MotionState { STATIONARY, WALKING, RUNNING, CYCLING, VEHICLE, UNKNOWN }

/** Why a frame was not taken. Recorded because a trigger that silently declines is undebuggable. */
enum class Suppression {
    NONE, POWER, THERMAL, STORAGE, MOTION_STATE, TOO_SLOW, TOO_FAST,
    RATE_LIMIT, NO_BASELINE, NO_NOVELTY, SCENE_UNCHANGED, POOR_FIX, PRIVACY_ZONE,
}

data class TriggerConfig(
    val captureHz: Double = 4.0,
    /** Geometry floor. See TriggerEngine.baselineForDepthTolerance. */
    val minBaselineM: Double = 0.75,
    /** Above this, viewpoint change starts to break feature matching. */
    val maxBaselineM: Double = 4.0,
    val minSpeedMps: Double = 0.4,
    val maxSpeedMps: Double = 22.0,
    val allowedStates: Set<MotionState> =
        setOf(MotionState.WALKING, MotionState.RUNNING, MotionState.CYCLING),
    val staleAfterS: Double = 30.0 * 24 * 3600,
    val sceneChangeThreshold: Double = 0.18,
    val maxPositionSigmaM: Double = 25.0,
    val minBatteryFraction: Double = 0.20,
    val maxDeviceTempC: Double = 42.0,
    val minFreeStorageMb: Double = 250.0,
    val burstLength: Int = 3,
)

data class CaptureContext(
    val timestampMs: Long,
    val motionState: MotionState,
    val speedMps: Double,
    val lat: Double,
    val lon: Double,
    val positionSigmaM: Double,
    val cellId: String,
    /** Seconds since this cell was last covered, or null if never. */
    val cellAgeS: Double?,
    val sceneDistance: Double,
    val batteryFraction: Double = 1.0,
    val deviceTempC: Double = 25.0,
    val freeStorageMb: Double = 10_000.0,
    val inPrivacyZone: Boolean = false,
)

data class CaptureDecision(
    val capture: Boolean,
    val reason: Suppression,
    val burstLength: Int = 0,
    val trigger: String? = null,
)
