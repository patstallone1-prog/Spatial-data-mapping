#include "KerbsideCelestialSky.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/WindDirectionalSourceComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "Components/CapsuleComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialParameterCollection.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Internationalization/Internationalization.h"
#include "Internationalization/Text.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "TimerManager.h"
#include "UnrealClient.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
    // The order K steps through them.
    const FName WeatherOrder[] = {"sunny", "partly_cloudy", "cloudy", "fog", "rain"};
    // Calm, a breeze, the summer afternoon westerly at its height, a winter gale.
    const float WindSteps[] = {0.f, 4.f, 9.f, 16.f};

    // Rain is a box of streaks round the camera, fixed in the world and wrapped as the camera
    // moves, so walking through it does not drag it along. Unreal units: centimetres.
    constexpr float RainHalfWidthCm = 2500.f;
    constexpr float RainHeightCm = 2000.f;
    constexpr float RainTopCm = 1500.f;
    constexpr float DropFallCmPerS = 900.f;     // a raindrop's terminal velocity, about 9 m/s
    constexpr float DropCarry = .6f;            // share of the wind's speed a falling drop takes
    // A unit cube drawn 4 mm across and 45 cm long: the streak a drop leaves in one frame's
    // exposure, which is what rain looks like rather than a drop.
    const FVector DropScale(.004f, .004f, .45f);

    float Wrap(float Value, float Span)
    {
        const float Out = FMath::Fmod(Value, Span);
        return Out < 0.f ? Out + Span : Out;
    }
}

FKerbsideWeatherLook FKerbsideWeatherLook::Lerp(const FKerbsideWeatherLook& A, const FKerbsideWeatherLook& B, float T)
{
    FKerbsideWeatherLook Out;
    Out.CloudCoverage = FMath::Lerp(A.CloudCoverage, B.CloudCoverage, T);
    Out.CloudDensity = FMath::Lerp(A.CloudDensity, B.CloudDensity, T);
    Out.FogDensity = FMath::Lerp(A.FogDensity, B.FogDensity, T);
    Out.FogHeightFalloff = FMath::Lerp(A.FogHeightFalloff, B.FogHeightFalloff, T);
    Out.Rain = FMath::Lerp(A.Rain, B.Rain, T);
    return Out;
}

bool AKerbsideCelestialSky::LookFor(FName Name, FKerbsideWeatherLook& Look)
{
    Look = FKerbsideWeatherLook();
    if (Name == "sunny") { Look.CloudCoverage = 0.f; Look.FogDensity = .002f; return true; }
    if (Name == "partly_cloudy") { Look.CloudCoverage = .45f; Look.FogDensity = .003f; return true; }
    if (Name == "cloudy") { Look.CloudCoverage = .95f; Look.CloudDensity = 1.2f; Look.FogDensity = .006f; return true; }
    // The marine layer: a low, dense bank that thins with height, under an overcast.
    if (Name == "fog") { Look.CloudCoverage = .9f; Look.FogDensity = .045f; Look.FogHeightFalloff = .06f; return true; }
    if (Name == "rain") { Look.CloudCoverage = 1.f; Look.CloudDensity = 1.6f; Look.FogDensity = .02f; Look.Rain = 1.f; return true; }
    return false;
}

TArray<FName> AKerbsideCelestialSky::WeatherNames()
{
    return TArray<FName>(WeatherOrder, UE_ARRAY_COUNT(WeatherOrder));
}

FVector AKerbsideCelestialSky::WindVector(float FromDegrees)
{
    // Blowing toward the opposite bearing; east is +X and north is -Y in this world.
    const float Toward = FMath::DegreesToRadians(FromDegrees + 180.f);
    return FVector(FMath::Sin(Toward), -FMath::Cos(Toward), 0.f).GetSafeNormal();
}

AKerbsideCelestialSky::AKerbsideCelestialSky(const FObjectInitializer& Init) : Super(Init)
{
    Latitude = 37.7749;
    Longitude = -122.4194;
    GMT_TimeZone = -8;
    NorthOffset = 0; // Epic's local frame: east +X, north -Y, up +Z, matching Kerbside.
    bUseCurrentDate = false;
    DaylightSavingsMode = EDaylightSavingsMode::None; // ICU applies the actual date's DST.
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 0.f;     // the rain moves every frame; the clock once a second
    SetRunDayCycle(false); // Wall clock, not an accelerated game-time loop.
    FoliageParameters = TSoftObjectPtr<UMaterialParameterCollection>(
        FSoftObjectPath(TEXT("/Game/KerbsideRuntime/Foliage/MPC_KerbsideFoliage.MPC_KerbsideFoliage")));

    RainStreaks = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("RainStreaks"));
    if (USceneComponent* Root = GetRootComponent()) RainStreaks->SetupAttachment(Root);
    RainStreaks->SetUsingAbsoluteLocation(true);
    RainStreaks->SetUsingAbsoluteRotation(true);
    RainStreaks->SetUsingAbsoluteScale(true);
    RainStreaks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    RainStreaks->SetCastShadow(false);
    RainStreaks->SetMobility(EComponentMobility::Movable);
    RainStreaks->bAffectDistanceFieldLighting = false;
    RainStreaks->SetVisibility(false);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Paint(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (Cube.Succeeded()) RainStreaks->SetStaticMesh(Cube.Object);
    if (Paint.Succeeded()) RainStreaks->SetMaterial(0, Paint.Object);

    WindSource = CreateDefaultSubobject<UWindDirectionalSourceComponent>(TEXT("Wind"));
    if (USceneComponent* Root = GetRootComponent()) WindSource->SetupAttachment(Root);
    WindSource->SetUsingAbsoluteRotation(true);
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

bool AKerbsideCelestialSky::SetWeather(FName NewWeather)
{
    FKerbsideWeatherLook Look;
    if (!LookFor(NewWeather, Look)) return false;
    Weather = NewWeather;
    Target = Look;
    return true;
}

void AKerbsideCelestialSky::SetWind(float MetresPerSecond, float FromDegrees)
{
    WindSpeed = FMath::Clamp(MetresPerSecond, 0.f, 40.f);
    WindFromDegrees = Wrap(FromDegrees, 360.f);
    ShowWind();
}

FName AKerbsideCelestialSky::CycleWeather()
{
    int32 At = 0;
    for (int32 I = 0; I < UE_ARRAY_COUNT(WeatherOrder); ++I) if (WeatherOrder[I] == Weather) At = I;
    SetWeather(WeatherOrder[(At + 1) % UE_ARRAY_COUNT(WeatherOrder)]);
    return Weather;
}

float AKerbsideCelestialSky::CycleWind()
{
    int32 Next = 0;
    for (int32 I = 0; I < UE_ARRAY_COUNT(WindSteps); ++I) if (WindSpeed >= WindSteps[I] - .5f) Next = I + 1;
    SetWind(WindSteps[Next % UE_ARRAY_COUNT(WindSteps)], WindFromDegrees);
    return WindSpeed;
}

void AKerbsideCelestialSky::ApplyWeather()
{
    FKerbsideWeatherLook Look;
    if (!LookFor(Weather, Look)) { Weather = "partly_cloudy"; LookFor(Weather, Look); }
    Target = Current = Look;
    ShowLook(Current);
    ShowWind();
}

void AKerbsideCelestialSky::ShowLook(const FKerbsideWeatherLook& Look)
{
    if (VolumetricCloudComponent)
    {
        VolumetricCloudComponent->SetVisibility(Look.CloudCoverage > .01f);
        if (!CloudMaterial && VolumetricCloudComponent->GetMaterial())
        {
            CloudMaterial = UMaterialInstanceDynamic::Create(VolumetricCloudComponent->GetMaterial(), this);
            VolumetricCloudComponent->SetMaterial(CloudMaterial);
        }
        if (CloudMaterial)
        {
            // Parameter names from Epic's bundled m_SimpleVolumetricCloud_TOD material.
            CloudMaterial->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), Look.CloudCoverage);
            CloudMaterial->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), Look.CloudDensity);
        }
    }
    if (ExponentialHeightFogComponent)
    {
        ExponentialHeightFogComponent->SetFogDensity(Look.FogDensity);
        ExponentialHeightFogComponent->SetFogHeightFalloff(Look.FogHeightFalloff);
        // A fog bank catches the light in shafts; a clear day's haze does not need to.
        ExponentialHeightFogComponent->SetVolumetricFog(Look.FogDensity > .015f);
    }
}

void AKerbsideCelestialSky::ShowWind()
{
    const FVector Toward = WindVector(WindFromDegrees);
    if (WindSource)
    {
        WindSource->SetWorldRotation(Toward.Rotation());
        // Unreal's wind source is unitless; a gale is full strength.
        WindSource->SetStrength(FMath::Clamp(WindSpeed / 16.f, 0.f, 1.f));
        WindSource->SetSpeed(FMath::Clamp(WindSpeed / 8.f, .02f, 2.f));
        WindSource->SetMinimumGustAmount(FMath::Clamp(WindSpeed / 40.f, 0.f, .5f));
        WindSource->SetMaximumGustAmount(FMath::Clamp(WindSpeed / 20.f, 0.f, 1.f));
    }
    if (CloudMaterial)
    {
        CloudMaterial->SetScalarParameterValue(TEXT("WindMultiplier"), WindSpeed / 4.f);
        CloudMaterial->SetVectorParameterValue(TEXT("CloudWind"), FLinearColor(Toward.X, Toward.Y, 0.f, WindSpeed));
    }
}

void AKerbsideCelestialSky::UpdateRain(float DeltaSeconds)
{
    if (!RainStreaks) return;
    const int32 Falling = FMath::RoundToInt(FMath::Clamp(Current.Rain, 0.f, 1.f) * MaxRainDrops);
    if (Falling == 0)
    {
        RainStreaks->SetVisibility(false);
        return;
    }
    const APlayerController* Player = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
    if (!Player || !Player->PlayerCameraManager) return;
    const FVector Eye = Player->PlayerCameraManager->GetCameraLocation();

    if (DropSeeds.Num() != MaxRainDrops)
    {
        FRandomStream Stream(1849);
        DropSeeds.SetNum(MaxRainDrops);
        for (FVector& Seed : DropSeeds) Seed = FVector(Stream.FRand(), Stream.FRand(), Stream.FRand());
        DropTransforms.Init(FTransform(FQuat::Identity, FVector::ZeroVector, FVector::ZeroVector), MaxRainDrops);
        RainStreaks->ClearInstances();
        RainStreaks->AddInstances(DropTransforms, false, false, false);
    }
    RainClock += DeltaSeconds;
    RainStreaks->SetWorldLocation(Eye);
    RainStreaks->SetVisibility(true);

    const FVector Carry = WindVector(WindFromDegrees) * WindSpeed * 100.f * DropCarry;
    const FQuat Along = FRotationMatrix::MakeFromZ(-(Carry + FVector(0.f, 0.f, -DropFallCmPerS))).ToQuat();
    const float Span = RainHalfWidthCm * 2.f;
    for (int32 I = 0; I < MaxRainDrops; ++I)
    {
        if (I >= Falling) { DropTransforms[I].SetScale3D(FVector::ZeroVector); continue; }
        const FVector& Seed = DropSeeds[I];
        // How far this drop has fallen since it entered at the top of the box.
        const float Fallen = Wrap(RainClock * DropFallCmPerS + Seed.Z * RainHeightCm, RainHeightCm);
        const FVector Drift = Carry * (Fallen / DropFallCmPerS);
        // Anchored in the world, wrapped into the box about the eye.
        const float X = Wrap(Seed.X * Span + Drift.X - Eye.X, Span) - RainHalfWidthCm;
        const float Y = Wrap(Seed.Y * Span + Drift.Y - Eye.Y, Span) - RainHalfWidthCm;
        DropTransforms[I] = FTransform(Along, FVector(X, Y, RainTopCm - Fallen), DropScale);
    }
    RainStreaks->BatchUpdateInstancesTransforms(0, DropTransforms, false, true, true);
}

void AKerbsideCelestialSky::BeginPlay()
{
    Super::BeginPlay();
    SyncClock();
    FString Named;
    if (FParse::Value(FCommandLine::Get(), TEXT("KerbsideWeather="), Named)) Weather = FName(*Named);
    float Wind = 0.f;
    if (FParse::Value(FCommandLine::Get(), TEXT("KerbsideWind="), Wind)) WindSpeed = FMath::Clamp(Wind, 0.f, 40.f);
    ApplyWeather();
    FString Shot;
    if (FParse::Value(FCommandLine::Get(), TEXT("KerbsideShot="), Shot))
    {
        float After = 10.f;
        FParse::Value(FCommandLine::Get(), TEXT("KerbsideShotAfter="), After);
        // -KerbsideShotPose=x,y,z,pitch,yaw (world cm, degrees) stands the walker there first.
        FString Pose;
        FParse::Value(FCommandLine::Get(), TEXT("KerbsideShotPose="), Pose, false);
        GetWorldTimerManager().SetTimer(ShotTimer, FTimerDelegate::CreateWeakLambda(this, [this, Shot, Pose]()
        {
            TArray<FString> Parts;
            Pose.ParseIntoArray(Parts, TEXT(","));
            APlayerController* Player = UGameplayStatics::GetPlayerController(this, 0);
            if (Parts.Num() == 5 && Player)
            {
                if (APawn* Walker = Player->GetPawn())
                {
                    Walker->SetActorLocation(FVector(FCString::Atof(*Parts[0]), FCString::Atof(*Parts[1]), FCString::Atof(*Parts[2])), false, nullptr, ETeleportType::TeleportPhysics);
                }
                Player->SetControlRotation(FRotator(FCString::Atof(*Parts[3]), FCString::Atof(*Parts[4]), 0.f));
            }
            // Two seconds for the view to settle and stream before the frame is taken.
            GetWorldTimerManager().SetTimer(ShotTimer, FTimerDelegate::CreateWeakLambda(this, [this, Shot]()
            {
                FScreenshotRequest::RequestScreenshot(Shot, false, false);
                GetWorldTimerManager().SetTimer(ShotTimer, FTimerDelegate::CreateWeakLambda(this, []()
                {
                    FPlatformMisc::RequestExit(false, TEXT("KerbsideShot"));
                }), 3.f, false);
            }), Parts.Num() == 5 ? 2.f : .01f, false);
        }), After, false);
    }
    if (RainStreaks && RainStreaks->GetMaterial(0))
    {
        UMaterialInstanceDynamic* Water = UMaterialInstanceDynamic::Create(RainStreaks->GetMaterial(0), this);
        Water->SetVectorParameterValue(TEXT("Color"), FLinearColor(.62f, .68f, .75f));
        RainStreaks->SetMaterial(0, Water);
    }
}

void AKerbsideCelestialSky::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    ClockSeconds += DeltaSeconds;
    if (ClockSeconds >= 1.f) { ClockSeconds = 0.f; SyncClock(); }
    // Ease toward the chosen weather: about a third of the way each third of the transition.
    const float T = TransitionSeconds > 0.f ? 1.f - FMath::Exp(-3.f * DeltaSeconds / TransitionSeconds) : 1.f;
    Current = FKerbsideWeatherLook::Lerp(Current, Target, T);
    ShowLook(Current);
    UpdateRain(DeltaSeconds);
    ShowFoliage();
}

void AKerbsideCelestialSky::ShowFoliage()
{
    // A world without the foliage collection (one imported before it existed) simply has
    // plants that stand still; it is looked for once, not every frame.
    if (!FoliageCollection)
    {
        if (FoliageParameters.IsNull()) return;
        FoliageCollection = FoliageParameters.LoadSynchronous();
        if (!FoliageCollection) { FoliageParameters.Reset(); return; }
    }
    const FVector Toward = WindVector(WindFromDegrees);
    UKismetMaterialLibrary::SetVectorParameterValue(this, FoliageCollection, TEXT("Wind"),
        FLinearColor(Toward.X, Toward.Y, WindSpeed, 0.f));
    if (const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
    {
        FVector Feet = Pawn->GetActorLocation();
        if (const ACharacter* Walker = Cast<ACharacter>(Pawn))
            Feet.Z -= Walker->GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
        UKismetMaterialLibrary::SetVectorParameterValue(this, FoliageCollection, TEXT("Walker"),
            FLinearColor(Feet.X, Feet.Y, Feet.Z, WalkerPressRadius));
    }
}

void AKerbsideCelestialSky::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform); SyncClock(); ApplyWeather();
}

namespace
{
    template <typename Fn>
    void ForEachSky(UWorld* World, Fn Each)
    {
        if (!World) return;
        for (TActorIterator<AKerbsideCelestialSky> It(World); It; ++It) Each(**It);
    }

    FAutoConsoleCommandWithWorldAndArgs WeatherCommand(
        TEXT("Kerbside.Weather"),
        TEXT("Kerbside.Weather <sunny|partly_cloudy|cloudy|fog|rain>: blend the sky to that weather."),
        FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
        {
            ForEachSky(World, [&](AKerbsideCelestialSky& Sky)
            {
                if (!Args.Num()) { Sky.CycleWeather(); return; }
                if (!Sky.SetWeather(FName(*Args[0])))
                    UE_LOG(LogTemp, Warning, TEXT("Kerbside.Weather: no weather called %s"), *Args[0]);
            });
        }));

    FAutoConsoleCommandWithWorldAndArgs WindCommand(
        TEXT("Kerbside.Wind"),
        TEXT("Kerbside.Wind <metres per second> [bearing it blows from, degrees]: set the wind."),
        FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
        {
            ForEachSky(World, [&](AKerbsideCelestialSky& Sky)
            {
                if (!Args.Num()) { Sky.CycleWind(); return; }
                Sky.SetWind(FCString::Atof(*Args[0]), Args.Num() > 1 ? FCString::Atof(*Args[1]) : Sky.WindFromDegrees);
            });
        }));
}
