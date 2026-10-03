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
};

UCLASS()
class KERBSIDEWORLD_API AKerbsideGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AKerbsideGameMode();
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
