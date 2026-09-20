using UnrealBuildTool;

public class KerbsideEditorTarget : TargetRules
{
    public KerbsideEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
        ExtraModuleNames.AddRange(new string[] { "Kerbside" });
    }
}
