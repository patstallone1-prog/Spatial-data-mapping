#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "KerbsideWorldActors.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

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
#endif
