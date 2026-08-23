package com.smc.glasses.batch

/**
 * WorkManager wiring for the nightly batch.
 *
 * Written as documentation-with-signatures rather than live code because the Android
 * dependencies are not wired in this build yet. The important part is the constraint set: it is
 * what turns "run at 2am" into "run at 2am *if* doing so is free for the user", and WorkManager
 * will simply defer to the next night when it is not.
 *
 * ```kotlin
 * val constraints = Constraints.Builder()
 *     .setRequiredNetworkType(NetworkType.UNMETERED)   // never spend cellular data
 *     .setRequiresCharging(true)                        // never spend battery the user needs
 *     .setRequiresBatteryNotLow(true)
 *     .setRequiresStorageNotLow(false)                  // low storage is a reason TO run
 *     .build()
 *
 * val request = PeriodicWorkRequestBuilder<DailyBatchWorker>(1, TimeUnit.DAYS)
 *     .setConstraints(constraints)
 *     .setInitialDelay(millisUntilNextWindow(System.currentTimeMillis()), TimeUnit.MILLISECONDS)
 *     .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
 *     .addTag(TAG)
 *     .build()
 *
 * WorkManager.getInstance(context)
 *     .enqueueUniquePeriodicWork(TAG, ExistingPeriodicWorkPolicy.KEEP, request)
 * ```
 *
 * `setRequiresStorageNotLow(false)` is deliberate and easy to get backwards: low storage is the
 * strongest possible reason to run the batch, since running it is what frees the space.
 *
 * The iOS counterpart is `BGProcessingTaskRequest` with `requiresNetworkConnectivity` and
 * `requiresExternalPower` set. iOS treats the schedule as advisory and will pick its own moment
 * near the window, which is fine — nothing here depends on the exact hour.
 */
object BatchScheduler {
    const val TAG = "smc-daily-batch"

    /** Rough guide to how long a night's work takes, for the foreground-service notice. */
    fun estimateRuntimeSeconds(frameCount: Int, megabytes: Double): Int {
        val assessSeconds = frameCount * 0.02          // thumbnail statistics
        val compressSeconds = frameCount * 0.12        // hardware encoder
        val uploadSeconds = megabytes / 2.5            // ~20 Mbps of usable Wi-Fi
        return (assessSeconds + compressSeconds + uploadSeconds).toInt() + 5
    }
}
