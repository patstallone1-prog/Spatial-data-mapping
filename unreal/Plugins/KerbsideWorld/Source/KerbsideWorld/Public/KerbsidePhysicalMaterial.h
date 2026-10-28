#pragma once
#include "CoreMinimal.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "KerbsidePhysicalMaterial.generated.h"

/**
 * A catalogue material (docs/object-catalogue.json) as physics sees it: its friction dry and
 * wet. tools/unreal/setup_world.py makes one per material the city uses. The sky's wetness
 * (AKerbsideCelestialSky) moves every one of them between the two, so wet road paint is
 * slippery under the walker as well as glossy to look at.
 */
UCLASS(BlueprintType)
class KERBSIDEWORLD_API UKerbsidePhysicalMaterial : public UPhysicalMaterial
{
    GENERATED_BODY()
public:
    /** The catalogue's id for it: asphalt, paint_marking, lumber, ... */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Kerbside|Surface") FName CatalogueMaterial;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Kerbside|Surface", meta=(ClampMin="0")) float DryFriction = .7f;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Kerbside|Surface", meta=(ClampMin="0")) float DryStaticFriction = .8f;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Kerbside|Surface", meta=(ClampMin="0")) float WetFriction = .5f;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Surface") float Wetness = 0.f;

    /** This material's friction at a wetness from 0 (dry) to 1 (soaked); static friction keeps its ratio. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Surface") void ShowWetness(float NewWetness);
    /** Every loaded Kerbside physical material at that wetness; returns how many. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Surface") static int32 WetAll(float NewWetness);
    /** Friction the walker's shoes have on a surface: a Kerbside material's current, else the plain one's. */
    static float WalkingFriction(const UPhysicalMaterial* Material);
};
