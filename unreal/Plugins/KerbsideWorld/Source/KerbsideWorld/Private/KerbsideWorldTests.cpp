#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "KerbsideWorldActors.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/BoxComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineGlobals.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/WorldSettings.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKerbsideWalkerDefaults, "Kerbside.World.WalkerDefaults",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FKerbsideWalkerDefaults::RunTest(const FString& Parameters)
{
    const AKerbsideWalker* Walker = GetDefault<AKerbsideWalker>();
    TestEqual(TEXT("Seven feet in centimetres"), Walker->GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight(), 106.68f);
    TestEqual(TEXT("First-person baseline"), Walker->GetCharacterMovement()->MaxWalkSpeed, 536.448f);
    TestEqual(TEXT("Gravity enabled"), Walker->GetCharacterMovement()->GravityScale, 1.f);
    TestEqual(TEXT("Curb step limit"), Walker->GetCharacterMovement()->MaxStepHeight, 20.f);
    TestTrue(TEXT("Camera rotates independently of translation"), Walker->Camera->bUsePawnControlRotation);
    TestEqual(TEXT("Game mode uses collision walker"), GetDefault<AKerbsideGameMode>()->DefaultPawnClass.Get(), AKerbsideWalker::StaticClass());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKerbsideSkyDefaults, "Kerbside.World.SkyDefaults",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FKerbsideSkyDefaults::RunTest(const FString& Parameters)
{
    const AKerbsideSky* Sky = GetDefault<AKerbsideSky>();
    TestNotNull(TEXT("Physical atmosphere present"), Sky->Atmosphere.Get());
    TestTrue(TEXT("Sun drives atmosphere"), bool(Sky->Sun->bAtmosphereSunLight));
    TestEqual(TEXT("Dynamic sun"), Sky->Sun->Mobility.GetValue(), EComponentMobility::Movable);
    TestTrue(TEXT("Shadow casting enabled"), bool(Sky->Sun->CastShadows));
    TestTrue(TEXT("Realtime sky capture enabled"), bool(Sky->SkyLight->bRealTimeCapture));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKerbsideCollisionAcceptance, "Kerbside.World.CollisionAcceptance",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FKerbsideCollisionAcceptance::RunTest(const FString& Parameters)
{
    // An isolated physics world; never loads or modifies the user's open map.
    const UWorld::InitializationValues Init = UWorld::InitializationValues()
        .AllowAudioPlayback(false).CreateNavigation(false).CreateAISystem(false)
        .RequiresHitProxies(false).CreatePhysicsScene(true).ShouldSimulatePhysics(true);
    UWorld* World = UWorld::CreateWorld(EWorldType::Game, false, NAME_None, nullptr, true,
        ERHIFeatureLevel::Num, &Init);
    if (!TestNotNull(TEXT("Physics test world"), World)) return false;
    GEngine->CreateNewWorldContext(EWorldType::Game).SetCurrentWorld(World);
    auto Box = [World](FVector Location, FVector Extent)
    {
        AActor* Actor = World->SpawnActor<AActor>();
        UBoxComponent* Component = NewObject<UBoxComponent>(Actor);
        Actor->SetRootComponent(Component);
        Component->SetBoxExtent(Extent);
        Component->SetCollisionProfileName(TEXT("BlockAll"));
        Component->RegisterComponent();
        Actor->SetActorLocation(Location);
        return Component;
    };
    Box(FVector(0, 0, -10), FVector(1000, 1000, 10));
    Box(FVector(300, 0, 150), FVector(10, 1000, 150));
    AKerbsideWalker* Walker = World->SpawnActor<AKerbsideWalker>(FVector(0, 0, 300), FRotator::ZeroRotator);
    if (!TestNotNull(TEXT("Collision walker"), Walker))
    {
        GEngine->DestroyWorldContext(World);
        World->DestroyWorld(false);
        return false;
    }
    World->InitializeActorsForPlay(FURL());
    World->BeginPlay();
    // This fixture has no game instance/auth game mode to dispatch StartPlay for us.
    World->GetWorldSettings()->NotifyBeginPlay();
    World->GetWorldSettings()->NotifyMatchStarted();
    UCharacterMovementComponent* Movement = Walker->GetCharacterMovement();
    Movement->bRunPhysicsWithNoController = true;
    Movement->SetMovementMode(MOVE_Falling);
    auto Tick = [World]()
    {
        // TickTaskManager queues each component only once per engine frame. This
        // synchronous automation fixture must advance frames as well as world time.
        ++GFrameCounter;
        World->Tick(LEVELTICK_All, 1.f / 60.f);
    };
    for (int32 Step = 0; Step < 180; ++Step) Tick();
    AddInfo(FString::Printf(TEXT("Settled position %s; mode %d"), *Walker->GetActorLocation().ToString(), int32(Movement->MovementMode)));
    TestTrue(TEXT("Gravity settles capsule on floor"), Movement->IsMovingOnGround());
    TestTrue(TEXT("Feet meet floor without sinking or floating"),
        FMath::Abs(Walker->GetActorLocation().Z - 106.68f) < 3.f);
    const FVector BeforeLook = Walker->GetActorLocation();
    Walker->Camera->SetRelativeRotation(FRotator(-40, 75, 0));
    for (int32 Step = 0; Step < 30; ++Step) Tick();
    TestTrue(TEXT("Camera rotation leaves feet in place"),
        Walker->GetActorLocation().Equals(BeforeLook, .1f));
    for (int32 Step = 0; Step < 180; ++Step)
    {
        Walker->AddMovementInput(FVector::ForwardVector, 1.f, true);
        Tick();
    }
    TestTrue(TEXT("Walker actually moves toward wall"), Walker->GetActorLocation().X > 200.f);
    AddInfo(FString::Printf(TEXT("Wall contact position %s"), *Walker->GetActorLocation().ToString()));
    TestTrue(TEXT("Capsule cannot pass through wall"), Walker->GetActorLocation().X < 260.f);
    World->EndPlay(EEndPlayReason::Quit);
    GEngine->DestroyWorldContext(World);
    World->DestroyWorld(false);
    return true;
}
#endif
