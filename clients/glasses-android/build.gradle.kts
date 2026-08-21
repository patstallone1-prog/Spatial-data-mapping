// Meta Wearables Device Access Toolkit client.
//
// The DAT artefacts come from Meta's developer channel, not Maven Central; see
// github.com/facebook/meta-wearables-dat-android for the current coordinates and version.
// Pinned deliberately loose here because the toolkit is in developer preview and its surface
// is still moving.
plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "com.smc.glasses"
    compileSdk = 35
    defaultConfig { minSdk = 29 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Platform activity recognition — the motion state source. Not reimplemented.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // implementation("com.meta.wearables:device-access-toolkit:0.6.x")  // see Meta dev channel
    testImplementation("junit:junit:4.13.2")
}
