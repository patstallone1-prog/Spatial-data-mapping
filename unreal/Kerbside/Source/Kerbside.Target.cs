using UnrealBuildTool;

public class KerbsideTarget : TargetRules
{
    public KerbsideTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.AddRange(new string[] { "Kerbside" });
    }
}
