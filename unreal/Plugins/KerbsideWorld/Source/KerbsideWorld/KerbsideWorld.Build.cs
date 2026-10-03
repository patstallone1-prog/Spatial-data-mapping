using UnrealBuildTool;

public class KerbsideWorld : ModuleRules
{
    public KerbsideWorld(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] {
            "Core", "CoreUObject", "Engine", "InputCore", "PhysicsCore"
        });
    }
}
