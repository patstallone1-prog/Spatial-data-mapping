using UnrealBuildTool;

public class Kerbside : ModuleRules
{
    public Kerbside(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
            "OnlineSubsystem", "OnlineSubsystemUtils", "OnlineSubsystemEOS", "Json", "JsonUtilities"
        });
    }
}
