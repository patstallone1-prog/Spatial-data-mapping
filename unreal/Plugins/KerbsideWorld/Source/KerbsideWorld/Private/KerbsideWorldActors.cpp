#include "KerbsideWorldActors.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InputComponent.h"
#include "EngineUtils.h"
#include "InputCoreTypes.h"
#include "KerbsideCelestialSky.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "PhysicsEngine/BodySetup.h"
#include "Engine/Engine.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#if WITH_EDITOR
#include "StaticMeshCompiler.h"
#endif

AKerbsideSky::AKerbsideSky()
{
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
    Atmosphere->SetupAttachment(RootComponent);
    Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
    Sun->SetupAttachment(RootComponent);
    Sun->SetMobility(EComponentMobility::Movable);
    Sun->SetIntensity(110000.f); // Lux; pair with EV100 exposure, not the web shader's tint.
    Sun->bAtmosphereSunLight = true;
    Sun->AtmosphereSunLightIndex = 0;
    Sun->LightSourceAngle = .5357f;
    Sun->SetCastShadows(true);
    SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
    SkyLight->SetupAttachment(RootComponent);
    SkyLight->SetMobility(EComponentMobility::Movable);
    SkyLight->SetRealTimeCaptureEnabled(true);
    SkyLight->SetIntensity(1.f);
    Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
    Fog->SetupAttachment(RootComponent);
    Fog->SetFogDensity(.002f);
    Fog->SetVolumetricFog(true);
}

void AKerbsideSky::UpdateDaylight()
{
    // Directional light points from sun to ground; north is -Y in this ENU consumer.
    Sun->SetRelativeRotation(FRotator(-SunElevation, SunBearing + 90.f, 0.f));
}

void AKerbsideSky::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    UpdateDaylight();
}

AKerbsideWalker::AKerbsideWalker()
{
    GetCapsuleComponent()->InitCapsuleSize(32.f, 106.68f); // 7 feet total, UE centimetres.
    GetCapsuleComponent()->SetCollisionProfileName(TEXT("Pawn"));
    bUseControllerRotationYaw = true;
    GetCharacterMovement()->bOrientRotationToMovement = false;
    GetCharacterMovement()->MaxWalkSpeed = 536.448f; // Existing first-person 12 mph.
    GetCharacterMovement()->MaxStepHeight = 20.f; // Curbs, not wall/fence climbing (catalogue step_height_m).
    GetCharacterMovement()->SetWalkableFloorAngle(45.f);
    GetCharacterMovement()->GravityScale = 1.f;
    GetCharacterMovement()->bUseFlatBaseForFloorChecks = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(GetCapsuleComponent());
    Camera->SetRelativeLocation(FVector(0.f, 0.f, 91.f));
    Camera->bUsePawnControlRotation = true;
    Camera->FieldOfView = 85.f;
    NearbyThings = CreateDefaultSubobject<UKerbsideNearbyComponent>(TEXT("NearbyThings"));
}

UKerbsideNearbyComponent::UKerbsideNearbyComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
}

void UKerbsideNearbyComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
    SinceRefresh += DeltaTime;
    if (SinceRefresh < IntervalSeconds) return;
    SinceRefresh = 0.f;
    Refresh();
}

void UKerbsideNearbyComponent::Refresh()
{
    AActor* Owner = GetOwner();
    UWorld* World = GetWorld();
    if (!Owner || !World) return;
    const FVector At = Owner->GetActorLocation();
    FCollisionQueryParams Query(SCENE_QUERY_STAT(KerbsideNearby), true, Owner);
    TMap<AActor*, FKerbsideNearbyThing> Found;
    auto Describe = [&Found](AActor* Actor) -> FKerbsideNearbyThing*
    {
        if (!Actor) return nullptr;
        if (FKerbsideNearbyThing* Known = Found.Find(Actor)) return Known;
        FKerbsideNearbyThing Thing;
        for (const FName& Tag : Actor->Tags)
        {
            FString Text = Tag.ToString(), Value;
            if (Text.Split(TEXT("kerbside.archetype:"), nullptr, &Value)) Thing.Archetype = FName(*Value);
            else if (Text.Split(TEXT("kerbside.material:"), nullptr, &Value)) Thing.Material = FName(*Value);
            else if (Text.Split(TEXT("kerbside.traversal:"), nullptr, &Value)) Thing.Traversal = FName(*Value);
        }
        if (Thing.Archetype.IsNone()) return nullptr;
        return &Found.Add(Actor, Thing);
    };
    TArray<FOverlapResult> Overlaps;
    World->OverlapMultiByChannel(Overlaps, At, FQuat::Identity, ECC_WorldStatic, FCollisionShape::MakeSphere(RadiusCm), Query);
    for (const FOverlapResult& Overlap : Overlaps) Describe(Overlap.GetActor());
    // Distances: rays round the walker at knee and chest height, the nearest hit per thing.
    for (const float Up : {-50.f, 40.f})
        for (int32 Ray = 0; Ray < 24; ++Ray)
        {
            const FVector Dir = FRotator(0.f, Ray * 15.f, 0.f).Vector();
            FHitResult Hit;
            if (!World->LineTraceSingleByChannel(Hit, At + FVector(0, 0, Up), At + FVector(0, 0, Up) + Dir * RadiusCm, ECC_Visibility, Query)) continue;
            if (FKerbsideNearbyThing* Thing = Describe(Hit.GetActor()))
                if (Thing->DistanceCm < 0.f || Hit.Distance < Thing->DistanceCm) Thing->DistanceCm = Hit.Distance;
        }
    Nearby.Reset();
    TSet<FName> Listed;
    Found.GenerateValueArray(Nearby);
    Nearby.Sort([](const FKerbsideNearbyThing& A, const FKerbsideNearbyThing& B)
    {
        return (A.DistanceCm < 0.f ? 1e9f : A.DistanceCm) < (B.DistanceCm < 0.f ? 1e9f : B.DistanceCm);
    });
    // One line per kind: the city is merged a surface per tile, so two tiles' trees are one kind.
    Nearby.RemoveAll([&Listed](const FKerbsideNearbyThing& Thing) { bool Seen = false; Listed.Add(Thing.Archetype, &Seen); return Seen; });
    if (bShowOnScreen && GEngine)
    {
        FString Text = FString::Printf(TEXT("Nearby within %.0f m"), RadiusCm / 100.f);
        for (const FKerbsideNearbyThing& Thing : Nearby)
        {
            if (Thing.Traversal == FName(TEXT("walk_on"))) continue;  // the ground underfoot
            Text += FString::Printf(TEXT("\n%s  %s  %s%s"), *Thing.Archetype.ToString(), *Thing.Traversal.ToString(), *Thing.Material.ToString(),
                Thing.DistanceCm >= 0.f ? *FString::Printf(TEXT("  %.1f m"), Thing.DistanceCm / 100.f) : TEXT(""));
        }
        GEngine->AddOnScreenDebugMessage(static_cast<uint64>(reinterpret_cast<UPTRINT>(this)), IntervalSeconds + .1f, FColor::White, Text);
    }
}

void AKerbsideWalker::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("KerbsideForward"), this, &AKerbsideWalker::MoveForward);
    Input->BindAxis(TEXT("KerbsideRight"), this, &AKerbsideWalker::MoveRight);
    Input->BindAxis(TEXT("KerbsideYaw"), this, &AKerbsideWalker::LookYaw);
    Input->BindAxis(TEXT("KerbsidePitch"), this, &AKerbsideWalker::LookPitch);
    // Bound to the keys themselves, so the managed input config is not edited for them.
    Input->BindKey(EKeys::K, IE_Pressed, this, &AKerbsideWalker::NextWeather);
    Input->BindKey(EKeys::J, IE_Pressed, this, &AKerbsideWalker::NextWind);
}

void AKerbsideWalker::NextWeather()
{
    for (TActorIterator<AKerbsideCelestialSky> It(GetWorld()); It; ++It) It->CycleWeather();
}

void AKerbsideWalker::NextWind()
{
    for (TActorIterator<AKerbsideCelestialSky> It(GetWorld()); It; ++It) It->CycleWind();
}

void AKerbsideWalker::MoveForward(float Value)
{
    if (Controller && !FMath::IsNearlyZero(Value))
        AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::X), Value);
}
void AKerbsideWalker::MoveRight(float Value)
{
    if (Controller && !FMath::IsNearlyZero(Value))
        AddMovementInput(FRotationMatrix(FRotator(0, Controller->GetControlRotation().Yaw, 0)).GetUnitAxis(EAxis::Y), Value);
}
void AKerbsideWalker::LookYaw(float Value) { AddControllerYawInput(Value); }
void AKerbsideWalker::LookPitch(float Value) { AddControllerPitchInput(Value); }

AKerbsideGameMode::AKerbsideGameMode() { DefaultPawnClass = AKerbsideWalker::StaticClass(); }

bool UKerbsideWorldLibrary::ConfigureWorldMesh(UStaticMesh* Mesh, bool BlocksPlayer)
{
    if (!Mesh) return false;
#if WITH_EDITOR
    if (BlocksPlayer)
    {
        // Complex collision uses the Nanite fallback, not its visible clusters.
        // Automatic relative-error simplification can erase curbs and ramp lips.
        FMeshNaniteSettings Settings = Mesh->GetNaniteSettings();
        const FMeshNaniteSettings Previous = Settings;
        Settings.GenerateFallback = ENaniteGenerateFallback::Enabled;
        Settings.FallbackTarget = ENaniteFallbackTarget::PercentTriangles;
        Settings.FallbackPercentTriangles = 1.f;
        Settings.FallbackRelativeError = 0.f;
        Settings.KeepPercentTriangles = 1.f;
        Settings.TrimRelativeError = 0.f;
        Mesh->SetNaniteSettings(Settings);
        if (Settings.bEnabled && !(Settings == Previous))
        {
            Mesh->NotifyNaniteSettingsChanged();
            // Cook collision only after the full-detail fallback replaces the old one.
            TArray<UStaticMesh*> PendingMeshes = {Mesh};
            FStaticMeshCompilingManager::Get().FinishCompilation(PendingMeshes);
        }
    }
#endif
    Mesh->CreateBodySetup();
    UBodySetup* Body = Mesh->GetBodySetup();
    if (!Body) return false;
    Body->CollisionTraceFlag = BlocksPlayer ? CTF_UseComplexAsSimple : CTF_UseDefault;
    Body->bDoubleSidedGeometry = BlocksPlayer;
    Body->DefaultInstance.SetCollisionProfileName(BlocksPlayer ? TEXT("BlockAll") : TEXT("NoCollision"));
#if WITH_EDITOR
    Body->InvalidatePhysicsData();
    Body->CreatePhysicsMeshes();
    Mesh->MarkPackageDirty();
#endif
    return true;
}

AKerbsideGrassField::AKerbsideGrassField()
{
    Grass = CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("Grass"));
    RootComponent = Grass;
    Grass->SetMobility(EComponentMobility::Static);
    Grass->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Grass->SetCastShadow(false);
    Grass->bEvaluateWorldPositionOffset = true;
    PrimaryActorTick.bCanEverTick = false;
}

int32 AKerbsideGrassField::PlantClumps(UStaticMesh* Clump, UMaterialInterface* Material, const TArray<FTransform>& Clumps, float CullCm)
{
    if (!Clump || !Grass) return 0;
    Grass->SetStaticMesh(Clump);
    if (Material) Grass->SetMaterial(0, Material);
    // Fade out over the last fifth of the range rather than stopping at a line.
    Grass->SetCullDistances(FMath::RoundToInt(CullCm * .8f), FMath::RoundToInt(CullCm));
    Grass->AddInstances(Clumps, false, true);
    return Grass->GetInstanceCount();
}
