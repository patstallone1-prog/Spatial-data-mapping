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
    /**
     * Which of Epic's cloud types are in the sky (the cloud material's Layout_CloudType):
     * r stratocumulus (the low heaped layer), g altostratus/altocumulus (the mid-level sheet and
     * its ripples), b cirrostratus (high ice), a nimbostratus (the rain deck).
     */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") FLinearColor CloudTypes = FLinearColor(1.f, .4f, .3f, 0.f);
    /** The cloud layer's base and depth, as multiples of what the vault set: a marine layer is low and thin. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float CloudBase = 1.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") float CloudDepth = 1.f;

    static FKerbsideWeatherLook Lerp(const FKerbsideWeatherLook& A, const FKerbsideWeatherLook& B, float T);
};

/**
 * Epic's Celestial Vault sky -- sun, moon, stars, atmosphere, volumetric clouds -- on San
 * Francisco's wall clock (ICU's America/Los_Angeles, the date's own daylight saving), with
 * weather: sunny, fair-weather cumulus, partly cloudy, high cirrus, a mackerel sky, overcast,
 * fog, drizzle, rain and a storm, and a wind that moves the clouds, bends
 * the rain and stirs anything that listens to wind sources. Changing either blends over
 * TransitionSeconds rather than cutting.
 *
 * In play, K steps through the weather and J through the wind (calm, breeze, windy, gale);
 * from the console, Kerbside.Weather <name> and Kerbside.Wind <m/s> [from-degrees]; at launch,
 * -KerbsideWeather=<name> -KerbsideWind=<m/s>, and -KerbsideShot=<png> [-KerbsideShotAfter=<s>]
 * [-KerbsideShotPose=x,y,z,pitch,yaw]
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
    /**
     * The foliage materials' wind and walker (tools/unreal/foliage_setup.py makes it): every
     * frame the sky writes Wind = (toward east, toward south, m/s, 0) and Walker = (the player's
     * feet in world cm, how far round them grass is pressed). Trees and shrubs sway in the wind
     * and grass parts round the walker in the material's world-position offset -- on the GPU,
     * as games do it, not as simulated branches. Nothing is moved that collides.
     */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Foliage") TSoftObjectPtr<class UMaterialParameterCollection> FoliageParameters;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Foliage", meta=(ClampMin="0")) float WalkerPressRadius = 55.f;
    /**
     * Wet ground (tools/unreal/weather_setup.py makes the collection and the decals): the sky
     * writes Wetness, 0 dry to 1 soaked, which darkens and glosses every surface the catalogue
     * lets get wet, and sets every UKerbsidePhysicalMaterial to the catalogue's wet friction in
     * proportion. Rain soaks the city in a few minutes; it dries over twenty once it stops, and
     * a fog leaves it damp.
     */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather") TSoftObjectPtr<class UMaterialParameterCollection> WeatherParameters;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Weather") float Wetness = 0.f;
    /** Seconds of full rain to soak a dry street, and seconds for a soaked one to dry. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather", meta=(ClampMin="1")) float SoakSeconds = 180.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Weather", meta=(ClampMin="1")) float DrySeconds = 1200.f;

    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void SyncClock();
    /** Jump straight to the chosen weather and wind (the editor, and the first frame). */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void ApplyWeather();
    /** Blend to a weather from here. Unknown names are refused and the sky is left as it is. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") bool SetWeather(FName NewWeather);
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void SetWind(float MetresPerSecond, float FromDegrees);
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") FName CycleWeather();
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") float CycleWind();
    /** Set how wet everything is now (Kerbside.Wetness); the weather carries on from there. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Weather") void SetWetness(float NewWetness);
    /** One step of wetting and drying: rain soaks, a fog dampens to a floor, anything else dries. */
    UFUNCTION(BlueprintPure, Category="Kerbside|Weather")
    static float NextWetness(float Wet, float Rain, float FogDensity, float DeltaSeconds, float Soak = 180.f, float Dry = 1200.f);

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
    UPROPERTY(Transient) TObjectPtr<class UMaterialParameterCollection> FoliageCollection;
    void ShowFoliage();
    void ShowWetness();
    UPROPERTY(Transient) TObjectPtr<class UMaterialParameterCollection> WeatherCollection;
    float ShownWetness = -1.f;
    float VaultCloudBaseKm = -1.f;
    float VaultCloudDepthKm = -1.f;
    FKerbsideWeatherLook Current;
    FKerbsideWeatherLook Target;
    float ClockSeconds = 0.f;
    float RainClock = 0.f;
    TArray<FVector> DropSeeds;      // x, y in [0,1) and a phase, per streak
    TArray<FTransform> DropTransforms;
    FTimerHandle ShotTimer;
};
