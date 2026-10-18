#pragma once
#include "CoreMinimal.h"
#include "CelestialVaultDaySequenceActor.h"
#include "KerbsideCelestialSky.generated.h"

/** What one kind of weather sets. A visual state, not a meteorological observation. */
USTRUCT(BlueprintType)
struct KERBSIDEWORLD_API FKerbsideWeatherLook
{
    GENERATED_BODY()
    /** Share of the sky under cloud (Epic's Cloud_GlobalCoverage). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float CloudCoverage = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float CloudDensity = 1.f;
    /** Exponential height fog density: 0.002 is a clear day's haze, 0.04 a fog bank. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float FogDensity = .002f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float FogHeightFalloff = .2f;
    /** 0 dry to 1 a downpour: the share of the rain streaks that are falling. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float Rain = 0.f;

    static FKerbsideWeatherLook Lerp(const FKerbsideWeatherLook& A, const FKerbsideWeatherLook& B, float T);
};

/**
 * Epic's Celestial Vault sky -- sun, moon, stars, atmosphere, volumetric clouds -- on San
 * Francisco's wall clock (ICU's America/Los_Angeles, the date's own daylight saving), with
 * weather: sunny, partly cloudy, cloudy, fog and rain, and a wind that moves the clouds, bends
 * the rain and stirs anything that listens to wind sources. Changing either blends over
 * TransitionSeconds rather than cutting.
 *
 * In play, K steps through the weather and J through the wind (calm, breeze, windy, gale);
 * from the console, Kerbside.Weather <name> and Kerbside.Wind <m/s> [from-degrees]; at launch,
 * -KerbsideWeather=<name> -KerbsideWind=<m/s>, and -KerbsideShot=<png> [-KerbsideShotAfter=<s>]
 * saves one frame and quits, for looking at a weather without sitting in it.
 */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideCelestialSky : public ACelestialVaultDaySequenceActor
{
    GENERATED_BODY()
public:
    AKerbsideCelestialSky(const FObjectInitializer& Init = FObjectInitializer::Get());
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky") bool bLiveClock = true;
    /** sunny, partly_cloudy, cloudy, fog or rain. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky") FName Weather = "partly_cloudy";
    /** Metres a second. San Francisco's afternoon sea breeze is four to nine. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky", meta=(ClampMin="0", ClampMax="40"))
    float WindSpeed = 4.f;
    /** The bearing the wind blows from, clockwise from north: the onshore westerly is 270. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky", meta=(ClampMin="0", ClampMax="360"))
    float WindFromDegrees = 270.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky", meta=(ClampMin="0"))
    float TransitionSeconds = 12.f;
    /** Rain streaks kept round the camera at full downpour. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Kerbside|Sky", meta=(ClampMin="0", ClampMax="20000"))
    int32 MaxRainDrops = 6000;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Sky") TObjectPtr<class UInstancedStaticMeshComponent> RainStreaks;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Sky") TObjectPtr<class UWindDirectionalSourceComponent> WindSource;

    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void SyncClock();
    /** Jump straight to the chosen weather and wind (the editor, and the first frame). */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void ApplyWeather();
    /** Blend to a weather from here. Unknown names are refused and the sky is left as it is. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") bool SetWeather(FName NewWeather);
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void SetWind(float MetresPerSecond, float FromDegrees);
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") FName CycleWeather();
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") float CycleWind();

    UFUNCTION(BlueprintPure, Category="Kerbside|Sky") static bool LookFor(FName Name, FKerbsideWeatherLook& Look);
    UFUNCTION(BlueprintPure, Category="Kerbside|Sky") static TArray<FName> WeatherNames();
    /** The direction the wind blows toward, in the world's frame (east +X, north -Y), unit length. */
    UFUNCTION(BlueprintPure, Category="Kerbside|Sky") static FVector WindVector(float FromDegrees);
    UFUNCTION(BlueprintPure, Category="Kerbside|Sky") FKerbsideWeatherLook CurrentLook() const { return Current; }

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void OnConstruction(const FTransform& Transform) override;
private:
    void ShowLook(const FKerbsideWeatherLook& Look);
    void ShowWind();
    void UpdateRain(float DeltaSeconds);
    UPROPERTY(Transient) TObjectPtr<class UMaterialInstanceDynamic> CloudMaterial;
    FKerbsideWeatherLook Current;
    FKerbsideWeatherLook Target;
    float ClockSeconds = 0.f;
    float RainClock = 0.f;
    TArray<FVector> DropSeeds;      // x, y in [0,1) and a phase, per streak
    TArray<FTransform> DropTransforms;
    FTimerHandle ShotTimer;
};
