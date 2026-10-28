#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "KerbsideWorldActors.h"
#include "KerbsideCelestialSky.h"
#include "KerbsidePhysicalMaterial.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/BoxComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/WindDirectionalSourceComponent.h"
#include "Engine/StaticMesh.h"
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
    TestNotNull(TEXT("Over-the-shoulder view"), Walker->ShoulderCamera.Get());
    TestFalse(TEXT("Through the eyes first"), Walker->ShoulderCamera->bAutoActivate);
    TestTrue(TEXT("Body unseen from inside"), Walker->GetMesh()->bOwnerNoSee);
    // The default character: by name, by index, else a roll; never out of the roster.
    const TArray<FString> Names = {TEXT("Ada"), TEXT("Bo"), TEXT("Celeste")};
    TestEqual(TEXT("Asked by name"), AKerbsideWalker::PickCharacter(Names, 3, TEXT("bo"), 7), 1);
    TestEqual(TEXT("Asked by index"), AKerbsideWalker::PickCharacter(Names, 3, TEXT("2"), 7), 2);
    TestEqual(TEXT("Random within roster"), AKerbsideWalker::PickCharacter(Names, 3, TEXT(""), 7), 1);
    TestEqual(TEXT("Negative roll still inside"), AKerbsideWalker::PickCharacter(Names, 3, TEXT("zed"), -4), 2);
    TestEqual(TEXT("Empty roster wears nothing"), AKerbsideWalker::PickCharacter(Names, 0, TEXT(""), 7), int32(INDEX_NONE));
    TestEqual(TEXT("Dry asphalt is normal grip"), AKerbsideWalker::GripFor(.7f), 1.f);
    TestTrue(TEXT("Wet paint grips less"), AKerbsideWalker::GripFor(.35f) < .6f);
    UKerbsidePhysicalMaterial* Paint = NewObject<UKerbsidePhysicalMaterial>();
    Paint->DryFriction = .55f; Paint->DryStaticFriction = .65f; Paint->WetFriction = .35f;
    Paint->ShowWetness(1.f);
    TestEqual(TEXT("Soaked paint has its wet friction"), Paint->Friction, .35f);
    Paint->ShowWetness(.5f);
    TestEqual(TEXT("Half wet is halfway"), Paint->Friction, .45f);
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKerbsideCelestialDefaults, "Kerbside.World.CelestialDefaults",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FKerbsideCelestialDefaults::RunTest(const FString& Parameters)
{
    const AKerbsideCelestialSky* Sky = GetDefault<AKerbsideCelestialSky>();
    TestEqual(TEXT("SF latitude"), Sky->Latitude, 37.7749);
    TestEqual(TEXT("SF longitude"), Sky->Longitude, -122.4194);
    TestTrue(TEXT("Wall clock enabled"), Sky->bLiveClock);
    TestFalse(TEXT("No accelerated day cycle"), Sky->GetRunDayCycle());
    TestNotNull(TEXT("Epic atmosphere"), Sky->SkyAtmosphereComponent.Get());
    TestNotNull(TEXT("Epic volumetric clouds"), Sky->VolumetricCloudComponent.Get());
    TestNotNull(TEXT("Sun"), Sky->SunLightComponent.Get());
    TestNotNull(TEXT("Moon"), Sky->MoonLightComponent.Get());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKerbsideWeatherLooks, "Kerbside.World.WeatherLooks",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FKerbsideWeatherLooks::RunTest(const FString& Parameters)
{
    FKerbsideWeatherLook Sunny, Partly, Cloudy, Fog, Rain, None;
    TestTrue(TEXT("sunny"), AKerbsideCelestialSky::LookFor("sunny", Sunny));
    TestTrue(TEXT("partly_cloudy"), AKerbsideCelestialSky::LookFor("partly_cloudy", Partly));
    TestTrue(TEXT("cloudy"), AKerbsideCelestialSky::LookFor("cloudy", Cloudy));
    TestTrue(TEXT("fog"), AKerbsideCelestialSky::LookFor("fog", Fog));
    TestTrue(TEXT("rain"), AKerbsideCelestialSky::LookFor("rain", Rain));
    TestFalse(TEXT("Unknown weather refused"), AKerbsideCelestialSky::LookFor("hail", None));
    TestEqual(TEXT("Ten weathers to step through"), AKerbsideCelestialSky::WeatherNames().Num(), 10);
    for (const FName& Name : AKerbsideCelestialSky::WeatherNames())
    {
        FKerbsideWeatherLook Look;
        TestTrue(*FString::Printf(TEXT("%s is a weather"), *Name.ToString()), AKerbsideCelestialSky::LookFor(Name, Look));
    }
    FKerbsideWeatherLook High, Storm, Drizzle;
    AKerbsideCelestialSky::LookFor("high_cloud", High);
    AKerbsideCelestialSky::LookFor("storm", Storm);
    AKerbsideCelestialSky::LookFor("drizzle", Drizzle);
    TestTrue(TEXT("Cirrus is high, thin ice cloud only"), High.CloudBase > 1.f && High.CloudTypes.B == 1.f && High.CloudTypes.R == 0.f);
    TestTrue(TEXT("A storm is the rain deck, denser than rain"), Storm.CloudTypes.A == 1.f && Storm.CloudDensity > Rain.CloudDensity);
    TestTrue(TEXT("Drizzle rains lightly"), Drizzle.Rain > 0.f && Drizzle.Rain < Rain.Rain);
    TestTrue(TEXT("Cloud cover rises sunny < partly < cloudy"),
        Sunny.CloudCoverage < Partly.CloudCoverage && Partly.CloudCoverage < Cloudy.CloudCoverage);
    TestTrue(TEXT("Fog is the densest fog"), Fog.FogDensity > Rain.FogDensity && Fog.FogDensity > 10 * Sunny.FogDensity);
    TestTrue(TEXT("Only rain rains"), Rain.Rain > .9f && Sunny.Rain + Partly.Rain + Cloudy.Rain + Fog.Rain == 0.f);
    // Wetting and drying: rain soaks in SoakSeconds, the sun dries, fog only dampens.
    TestEqual(TEXT("Three minutes of rain soaks"), AKerbsideCelestialSky::NextWetness(0.f, 1.f, .02f, 180.f), 1.f);
    TestEqual(TEXT("Drizzle soaks a quarter as fast"), AKerbsideCelestialSky::NextWetness(0.f, .25f, .012f, 180.f), .25f);
    TestEqual(TEXT("Twenty minutes dries"), AKerbsideCelestialSky::NextWetness(1.f, 0.f, .002f, 1200.f), 0.f);
    TestEqual(TEXT("Fog leaves it damp, not dry"), AKerbsideCelestialSky::NextWetness(1.f, 0.f, .045f, 5000.f), .2f);
    TestTrue(TEXT("Fog dampens a dry street, slowly"), AKerbsideCelestialSky::NextWetness(0.f, 0.f, .045f, 60.f) > 0.f);
    const FKerbsideWeatherLook Half = FKerbsideWeatherLook::Lerp(Sunny, Rain, .5f);
    TestEqual(TEXT("Blends halfway"), Half.Rain, .5f);
    // A westerly blows toward the east (+X); a northerly toward the south (+Y in this frame).
    TestTrue(TEXT("Westerly blows east"), AKerbsideCelestialSky::WindVector(270.f).Equals(FVector(1, 0, 0), 1e-4));
    TestTrue(TEXT("Northerly blows south"), AKerbsideCelestialSky::WindVector(0.f).Equals(FVector(0, 1, 0), 1e-4));
    const AKerbsideCelestialSky* Sky = GetDefault<AKerbsideCelestialSky>();
    TestNotNull(TEXT("Rain streaks"), Sky->RainStreaks.Get());
    const UStaticMesh* Streak = Sky->RainStreaks ? Sky->RainStreaks->GetStaticMesh().Get() : nullptr;
    TestNotNull(TEXT("Rain streak mesh"), Streak);
    TestNotNull(TEXT("Wind source"), Sky->WindSource.Get());
    TestTrue(TEXT("Rain never collides"), Sky->RainStreaks && !Sky->RainStreaks->IsCollisionEnabled());
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
