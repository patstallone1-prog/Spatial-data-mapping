#pragma once
#include "CoreMinimal.h"
#include "CelestialVaultDaySequenceActor.h"
#include "KerbsideCelestialSky.generated.h"

/** Epic's complete sky, synchronized using ICU's America/Los_Angeles clock. */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideCelestialSky : public ACelestialVaultDaySequenceActor
{
    GENERATED_BODY()
public:
    AKerbsideCelestialSky(const FObjectInitializer& Init = FObjectInitializer::Get());
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky") bool bLiveClock = true;
    /** Visual preview, not a live meteorological observation: sunny/partly_cloudy/cloudy/rain. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Sky") FName Weather = "partly_cloudy";
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void SyncClock();
    UFUNCTION(BlueprintCallable, Category="Kerbside|Sky") void ApplyWeather();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void OnConstruction(const FTransform& Transform) override;
private:
    UPROPERTY(Transient) TObjectPtr<class UMaterialInstanceDynamic> CloudMaterial;
};
