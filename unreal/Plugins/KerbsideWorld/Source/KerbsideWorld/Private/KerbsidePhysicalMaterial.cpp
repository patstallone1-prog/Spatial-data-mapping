#include "KerbsidePhysicalMaterial.h"
#include "Chaos/ChaosEngineInterface.h"
#include "UObject/UObjectIterator.h"

void UKerbsidePhysicalMaterial::ShowWetness(float NewWetness)
{
    Wetness = FMath::Clamp(NewWetness, 0.f, 1.f);
    Friction = FMath::Lerp(DryFriction, WetFriction, Wetness);
    const float Ratio = DryFriction > 0.f ? WetFriction / DryFriction : 1.f;
    StaticFriction = FMath::Lerp(DryStaticFriction, DryStaticFriction * Ratio, Wetness);
    // The solver keeps its own copy; hand it the new values.
    if (!HasAnyFlags(RF_ClassDefaultObject)) FChaosEngineInterface::UpdateMaterial(GetPhysicsMaterial(), this);
}

int32 UKerbsidePhysicalMaterial::WetAll(float NewWetness)
{
    int32 Count = 0;
    for (TObjectIterator<UKerbsidePhysicalMaterial> It; It; ++It)
    {
        if (It->HasAnyFlags(RF_ClassDefaultObject)) continue;
        It->ShowWetness(NewWetness);
        ++Count;
    }
    return Count;
}

float UKerbsidePhysicalMaterial::WalkingFriction(const UPhysicalMaterial* Material)
{
    return Material ? Material->Friction : .7f;
}
