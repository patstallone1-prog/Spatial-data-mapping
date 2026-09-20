using UnrealBuildTool;

public class KerbsideTarget : TargetRules
{
    public KerbsideTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
        ExtraModuleNames.AddRange(new string[] { "Kerbside" });
    }
}
