#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Character.h"
#include "GameFramework/GameModeBase.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "KerbsideWorldActors.generated.h"

/** One native atmosphere rig. Does not alter city geometry or surveyed elevations. */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideSky : public AActor
{
    GENERATED_BODY()
public:
    AKerbsideSky();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class USkyAtmosphereComponent> Atmosphere;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UDirectionalLightComponent> Sun;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class USkyLightComponent> SkyLight;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UExponentialHeightFogComponent> Fog;
    /** Degrees above horizon, not a claim about live weather/time. East=X, south=Y. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Daylight", meta=(ClampMin="-10", ClampMax="90"))
    float SunElevation = 45.f;
    /** Bearing clockwise from true north. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Daylight") float SunBearing = 210.f;
    UFUNCTION(BlueprintCallable, Category="Daylight") void UpdateDaylight();
    virtual void OnConstruction(const FTransform& Transform) override;
};

/** Collision-driven walker: no free-flight pawn, camera motion never translates feet. */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideWalker : public ACharacter
{
    GENERATED_BODY()
public:
    AKerbsideWalker();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UCameraComponent> Camera;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
private:
    void MoveForward(float Value);
    void MoveRight(float Value);
    void LookYaw(float Value);
    void LookPitch(float Value);
    /** K and J: the next weather, the next wind (KerbsideCelestialSky). */
    void NextWeather();
    void NextWind();
};

UCLASS()
class KERBSIDEWORLD_API AKerbsideGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AKerbsideGameMode();
};

/**
 * The grass on a tile's lawns: clumps of blades as hierarchical instances, placed by the
 * exporter on park and yard ground and off every path, court and kerb. Its material bends the
 * blades in the wind and away from the walker (KerbsideCelestialSky::FoliageParameters). Drawn
 * only near the camera; never collides. Inferred ground cover, not surveyed plants.
 */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideGrassField : public AActor
{
    GENERATED_BODY()
public:
    AKerbsideGrassField();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Foliage") TObjectPtr<class UHierarchicalInstancedStaticMeshComponent> Grass;
    /** Clumps as (x, y, z cm, yaw degrees) and scale; the mesh and material set before. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Foliage")
    int32 PlantClumps(class UStaticMesh* Clump, class UMaterialInterface* Material, const TArray<FTransform>& Clumps, float CullCm = 6000.f);
};

/** Editor importer bridge; the imported city is static, never simulated as a loose body. */
UCLASS()
class KERBSIDEWORLD_API UKerbsideWorldLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="Kerbside")
    static bool ConfigureWorldMesh(class UStaticMesh* Mesh, bool BlocksPlayer);
};
