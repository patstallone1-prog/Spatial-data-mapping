#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Character.h"
#include "GameFramework/GameModeBase.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "KerbsideWorldActors.generated.h"

/** One native atmosphere rig. Does not alter city geometry or surveyed elevations. */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideSky : public AActor
{
    GENERATED_BODY()
public:
    AKerbsideSky();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class USkyAtmosphereComponent> Atmosphere;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UDirectionalLightComponent> Sun;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class USkyLightComponent> SkyLight;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UExponentialHeightFogComponent> Fog;
    /** Degrees above horizon, not a claim about live weather/time. East=X, south=Y. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Daylight", meta=(ClampMin="-10", ClampMax="90"))
    float SunElevation = 45.f;
    /** Bearing clockwise from true north. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Daylight") float SunBearing = 210.f;
    UFUNCTION(BlueprintCallable, Category="Daylight") void UpdateDaylight();
    virtual void OnConstruction(const FTransform& Transform) override;
};

/** One thing within the walker's interaction radius, as the importer tagged it from docs/object-catalogue.json. */
USTRUCT(BlueprintType)
struct KERBSIDEWORLD_API FKerbsideNearbyThing
{
    GENERATED_BODY()
    /** kerbside.archetype:... -- e.g. furniture.street_light, vegetation.tree. */
    UPROPERTY(BlueprintReadOnly, Category="Kerbside|Nearby") FName Archetype;
    UPROPERTY(BlueprintReadOnly, Category="Kerbside|Nearby") FName Material;
    /** go_around, step_over, climb_over, walk_under, pass_through, enter, walk_on, swim. */
    UPROPERTY(BlueprintReadOnly, Category="Kerbside|Nearby") FName Traversal;
    /** To the nearest surface a probe ray met at knee or chest height; -1 where only overlapped. */
    UPROPERTY(BlueprintReadOnly, Category="Kerbside|Nearby") float DistanceCm = -1.f;
};

/**
 * What is round the walker, within the same radius the page uses (object catalogue
 * player.interaction_radius_m): every tagged city actor the radius overlaps, nearest first.
 * The city is merged a surface per tile, so one entry is "street lights within reach", not one
 * light. Collision itself is the meshes' own (setup_world.py makes the catalogue's solid
 * surfaces BlockAll); this only describes.
 */
UCLASS(ClassGroup=(Kerbside), meta=(BlueprintSpawnableComponent))
class KERBSIDEWORLD_API UKerbsideNearbyComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    UKerbsideNearbyComponent();
    /** docs/object-catalogue.json player.interaction_radius_m, in centimetres. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Nearby") float RadiusCm = 600.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Nearby") float IntervalSeconds = .5f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Kerbside|Nearby") bool bShowOnScreen = true;
    UPROPERTY(BlueprintReadOnly, Category="Kerbside|Nearby") TArray<FKerbsideNearbyThing> Nearby;
    UFUNCTION(BlueprintCallable, Category="Kerbside|Nearby") void Refresh();
    virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
private:
    float SinceRefresh = 0.f;
};

/** Collision-driven walker: no free-flight pawn, camera motion never translates feet. */
UCLASS(Blueprintable, Config=Game)
class KERBSIDEWORLD_API AKerbsideWalker : public ACharacter
{
    GENERATED_BODY()
public:
    AKerbsideWalker();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UCameraComponent> Camera;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<UKerbsideNearbyComponent> NearbyThings;
    /** Behind the shoulder, for seeing who you are (V switches to it and back). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class USpringArmComponent> Boom;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<class UCameraComponent> ShoulderCamera;
    /**
     * The default characters a player is given one of at random (tools/unreal/characters_setup.py
     * writes the list into DefaultGame.ini). Each entry is a skeletal mesh on the UE5 mannequin
     * skeleton, worn as the walker's own mesh, or an actor class -- a built MetaHuman -- whose
     * skeletal meshes follow the walker's animated mesh.
     */
    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category="Kerbside|Character") TArray<FSoftObjectPath> Roster;
    /** Shown in the corner and the log: the roster entry's own name. */
    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category="Kerbside|Character") TArray<FString> RosterNames;
    /** The animation the walker's mesh plays: Epic's unarmed locomotion. */
    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category="Kerbside|Character") FSoftClassPath Animation;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Character") FString CharacterName;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Character") TObjectPtr<class UChildActorComponent> Appearance;

    /** Wear roster entry Index; false if it is missing or will not load. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Character") bool WearCharacter(int32 Index);
    /** Which entry a player gets: -KerbsideCharacter=<name or index> if given, else at random. */
    static int32 PickCharacter(const TArray<FString>& Names, int32 Count, const FString& Asked, int32 Roll);
    UFUNCTION(BlueprintCallable, Category="Kerbside|Character") void ToggleView();
    /**
     * How grippy the ground is underfoot scales how hard the walker can turn and stop:
     * CharacterMovement's own ground friction ignores the surface, so a soaked painted line would
     * otherwise feel like dry asphalt. Friction 0.7 (dry asphalt) is the walker's normal grip.
     */
    static float GripFor(float SurfaceFriction);
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
private:
    void MoveForward(float Value);
    void MoveRight(float Value);
    void LookYaw(float Value);
    void LookPitch(float Value);
    /** K and J: the next weather, the next wind (KerbsideCelestialSky). */
    void NextWeather();
    void NextWind();
    void NextCharacter();
    int32 Wearing = INDEX_NONE;
    float BaseGroundFriction = 8.f;
    float BaseBraking = 2048.f;
};

UCLASS()
class KERBSIDEWORLD_API AKerbsideGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AKerbsideGameMode();
};

/**
 * The grass on a tile's lawns: clumps of blades as hierarchical instances, placed by the
 * exporter on park and yard ground and off every path, court and kerb. Its material bends the
 * blades in the wind and away from the walker (KerbsideCelestialSky::FoliageParameters). Drawn
 * only near the camera; never collides. Inferred ground cover, not surveyed plants.
 */
UCLASS(Blueprintable)
class KERBSIDEWORLD_API AKerbsideGrassField : public AActor
{
    GENERATED_BODY()
public:
    AKerbsideGrassField();
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Kerbside|Foliage") TObjectPtr<class UHierarchicalInstancedStaticMeshComponent> Grass;
    /** Clumps as (x, y, z cm, yaw degrees) and scale; the mesh and material set before. */
    UFUNCTION(BlueprintCallable, Category="Kerbside|Foliage")
    int32 PlantClumps(class UStaticMesh* Clump, class UMaterialInterface* Material, const TArray<FTransform>& Clumps, float CullCm = 6000.f);
};

/** Editor importer bridge; the imported city is static, never simulated as a loose body. */
UCLASS()
class KERBSIDEWORLD_API UKerbsideWorldLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="Kerbside")
    static bool ConfigureWorldMesh(class UStaticMesh* Mesh, bool BlocksPlayer);
};
