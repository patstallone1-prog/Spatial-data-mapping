using UnrealBuildTool;

public class KerbsideEditorTarget : TargetRules
{
    public KerbsideEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.AddRange(new string[] { "Kerbside" });
    }
}
