#include "KerbsideWorldActors.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InputComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "PhysicsEngine/BodySetup.h"
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
    GetCharacterMovement()->MaxStepHeight = 20.f; // Curbs, not wall/fence climbing.
    GetCharacterMovement()->SetWalkableFloorAngle(45.f);
    GetCharacterMovement()->GravityScale = 1.f;
    GetCharacterMovement()->bUseFlatBaseForFloorChecks = true;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(GetCapsuleComponent());
    Camera->SetRelativeLocation(FVector(0.f, 0.f, 91.f));
    Camera->bUsePawnControlRotation = true;
    Camera->FieldOfView = 85.f;
}

void AKerbsideWalker::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("KerbsideForward"), this, &AKerbsideWalker::MoveForward);
    Input->BindAxis(TEXT("KerbsideRight"), this, &AKerbsideWalker::MoveRight);
    Input->BindAxis(TEXT("KerbsideYaw"), this, &AKerbsideWalker::LookYaw);
    Input->BindAxis(TEXT("KerbsidePitch"), this, &AKerbsideWalker::LookPitch);
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
