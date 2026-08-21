package com.smc.glasses.capture

import kotlin.math.exp
import kotlin.math.tan

/**
 * On-device port of the capture trigger.
 *
 * This deliberately mirrors `smc.capture.trigger` line for line rather than calling into a
 * shared native library. The Python version is the reference implementation and is where the
 * policy is tested against simulated drives; this one has to run in a foreground service on a
 * battery, with no Python runtime. Keeping them structurally identical means a change to the
 * policy is a diff in two files that look the same, and `TriggerParityTest` replays the same
 * fixtures through both.
 *
 * The rules that matter, in the order they are checked:
 *  - device health first, because those checks are free and everything after costs sensors;
 *  - motion state before speed, so a wearer riding in a car is excluded before any geometry;
 *  - distance travelled, not elapsed time, as the capture gate. A wearer at 1.4 m/s triggered
 *    on a 4 Hz clock puts frames 0.35 m apart, which is 98% overlap and far too short a
 *    baseline to triangulate. Distance holds the baseline constant across walking, cycling and
 *    driving, and saves battery exactly when frames are most redundant.
 */
class TriggerEngine(private val config: TriggerConfig = TriggerConfig()) {

    private var lastCaptureMs: Long? = null
    private var lastSeenMs: Long? = null
    private var distanceSinceCaptureM: Double = 0.0
    private val reasons = mutableMapOf<Suppression, Int>()

    var capturedCount: Int = 0
        private set

    val reasonHistogram: Map<Suppression, Int> get() = reasons.toMap()

    fun evaluate(ctx: CaptureContext): CaptureDecision {
        accumulateDistance(ctx)
        val decision = decide(ctx)
        if (decision.capture) {
            lastCaptureMs = ctx.timestampMs
            distanceSinceCaptureM = 0.0
            capturedCount++
        } else {
            reasons[decision.reason] = (reasons[decision.reason] ?: 0) + 1
        }
        return decision
    }

    /**
     * Dead-reckons from speed rather than differencing GNSS fixes.
     *
     * At 5 m of position noise, two fixes 250 ms apart give a distance that is entirely noise,
     * and would fire the baseline gate at random while the wearer stands still.
     */
    private fun accumulateDistance(ctx: CaptureContext) {
        lastSeenMs?.let { previous ->
            val dt = (ctx.timestampMs - previous) / 1000.0
            if (dt > 0.0 && dt < 5.0) distanceSinceCaptureM += ctx.speedMps * dt
        }
        lastSeenMs = ctx.timestampMs
    }

    private fun decide(ctx: CaptureContext): CaptureDecision {
        if (ctx.inPrivacyZone) return CaptureDecision(false, Suppression.PRIVACY_ZONE)
        if (ctx.batteryFraction < config.minBatteryFraction) {
            return CaptureDecision(false, Suppression.POWER)
        }
        if (ctx.deviceTempC > config.maxDeviceTempC) {
            return CaptureDecision(false, Suppression.THERMAL)
        }
        if (ctx.freeStorageMb < config.minFreeStorageMb) {
            return CaptureDecision(false, Suppression.STORAGE)
        }

        if (ctx.motionState !in config.allowedStates) {
            return CaptureDecision(false, Suppression.MOTION_STATE)
        }
        if (ctx.speedMps < config.minSpeedMps) return CaptureDecision(false, Suppression.TOO_SLOW)
        if (ctx.speedMps > config.maxSpeedMps) return CaptureDecision(false, Suppression.TOO_FAST)
        if (ctx.positionSigmaM > config.maxPositionSigmaM) {
            return CaptureDecision(false, Suppression.POOR_FIX)
        }

        val first = lastCaptureMs == null
        if (!first) {
            val elapsed = (ctx.timestampMs - lastCaptureMs!!) / 1000.0
            if (elapsed < 1.0 / config.captureHz - 1e-9) {
                return CaptureDecision(false, Suppression.RATE_LIMIT)
            }
            if (distanceSinceCaptureM >= config.maxBaselineM) {
                return CaptureDecision(true, Suppression.NONE, config.burstLength, "max_baseline")
            }
            if (distanceSinceCaptureM < config.minBaselineM) {
                return CaptureDecision(false, Suppression.NO_BASELINE)
            }
        }

        val novel = ctx.cellAgeS == null || ctx.cellAgeS > config.staleAfterS
        if (novel) return CaptureDecision(true, Suppression.NONE, config.burstLength, "novelty")

        if (ctx.sceneDistance >= config.sceneChangeThreshold) {
            return CaptureDecision(true, Suppression.NONE, config.burstLength, "scene_change")
        }
        return CaptureDecision(false, Suppression.SCENE_UNCHANGED)
    }

    companion object {
        /** Baseline needed to resolve depth at [rangeM] to [toleranceM]. Sets minBaselineM. */
        fun baselineForDepthTolerance(
            rangeM: Double,
            toleranceM: Double,
            focalPx: Double = 960.0,
            matchErrorPx: Double = 0.5,
        ): Double {
            require(rangeM > 0 && toleranceM > 0) { "range and tolerance must be positive" }
            return rangeM * rangeM * matchErrorPx / (focalPx * toleranceM)
        }

        /** Fraction of the footprint shared by consecutive captures. */
        fun overlapFraction(
            speedMps: Double,
            captureHz: Double,
            rangeM: Double,
            fovDeg: Double = 90.0,
        ): Double {
            require(captureHz > 0 && rangeM > 0) { "captureHz and rangeM must be positive" }
            val footprint = 2.0 * rangeM * tan(Math.toRadians(fovDeg) / 2.0)
            return (1.0 - (speedMps / captureHz) / footprint).coerceAtLeast(0.0)
        }

        /** Battery model: capture cost decays as the trigger rejects more frames. */
        fun estimatedFramesPerHour(speedMps: Double, config: TriggerConfig = TriggerConfig()): Double {
            val byRate = config.captureHz * 3600.0
            val byBaseline = if (config.minBaselineM > 0) speedMps * 3600.0 / config.minBaselineM
            else Double.MAX_VALUE
            return minOf(byRate, byBaseline) * (1.0 - exp(-speedMps))
        }
    }
}
