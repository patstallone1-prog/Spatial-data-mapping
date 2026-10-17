#include "KerbsideCelestialSky.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Internationalization/Internationalization.h"
#include "Internationalization/Text.h"

AKerbsideCelestialSky::AKerbsideCelestialSky(const FObjectInitializer& Init) : Super(Init)
{
    Latitude = 37.7749;
    Longitude = -122.4194;
    GMT_TimeZone = -8;
    NorthOffset = 0; // Epic's local frame: east +X, north -Y, up +Z, matching Kerbside.
    bUseCurrentDate = false;
    DaylightSavingsMode = EDaylightSavingsMode::None; // ICU applies the actual date's DST.
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 1.f;
    SetRunDayCycle(false); // Wall clock, not an accelerated game-time loop.
}

void AKerbsideCelestialSky::SyncClock()
{
    if (!bLiveClock) return;
    const FDateTime UTC = FDateTime::UtcNow();
    const FString Text = FText::AsDateTime(UTC, TEXT("yyyy-MM-dd'T'HH:mm:ss"),
        TEXT("America/Los_Angeles"), FInternationalization::Get().GetCulture(TEXT("en-US"))).ToString();
    FDateTime Local;
    if (!FDateTime::ParseIso8601(*Text, Local)) return;
    const bool ChangedDate = Year != Local.GetYear() || int(Month) != Local.GetMonth() || Day != Local.GetDay();
    Year = Local.GetYear(); Month = EMonth(Local.GetMonth()); Day = Local.GetDay();
    GMT_TimeZone = FMath::RoundToInt((Local - UTC).GetTotalHours());
    if (ChangedDate) Super::OnConstruction(GetActorTransform());
    SetTimeOfDay(Local.GetHour() + Local.GetMinute()/60.f + Local.GetSecond()/3600.f);
}

void AKerbsideCelestialSky::ApplyWeather()
{
    const float Coverage = Weather == "sunny" ? 0.f : Weather == "partly_cloudy" ? .4f : .95f;
    if (VolumetricCloudComponent)
    {
        VolumetricCloudComponent->SetVisibility(Coverage > 0);
        if (!CloudMaterial && VolumetricCloudComponent->GetMaterial())
            CloudMaterial = UMaterialInstanceDynamic::Create(VolumetricCloudComponent->GetMaterial(), this);
        if (CloudMaterial)
        {
            // Parameter names from Epic's bundled m_SimpleVolumetricCloud_TOD material.
            CloudMaterial->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), Coverage);
            CloudMaterial->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), Weather == "rain" ? 1.5f : 1.f);
            VolumetricCloudComponent->SetMaterial(CloudMaterial);
        }
    }
    if (ExponentialHeightFogComponent)
        ExponentialHeightFogComponent->SetFogDensity(Weather == "rain" ? .015f : .002f);
}
void AKerbsideCelestialSky::BeginPlay() { Super::BeginPlay(); SyncClock(); ApplyWeather(); }
void AKerbsideCelestialSky::Tick(float DeltaSeconds) { Super::Tick(DeltaSeconds); SyncClock(); }
void AKerbsideCelestialSky::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform); SyncClock(); ApplyWeather();
}
