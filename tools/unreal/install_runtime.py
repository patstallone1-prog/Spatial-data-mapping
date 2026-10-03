"""Install repo-owned runtime into an existing project, preserving user-owned files.

Generates configuration and mechanically copies versioned plugin/source files. Every
subsequent install refuses to overwrite edits to previously installed source files.
No Epic/EOS credentials are copied. Existing maps/content are never removed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BEGIN = "; BEGIN KERBSIDE MANAGED RUNTIME"
END = "; END KERBSIDE MANAGED RUNTIME"

ENGINE_CONFIG = """[/Script/EngineSettings.GameMapsSettings]
GlobalDefaultGameMode=/Script/KerbsideWorld.KerbsideGameMode

[/Script/Engine.RendererSettings]
r.AllowStaticLighting=False
r.GenerateMeshDistanceFields=True
r.DynamicGlobalIlluminationMethod=1
r.ReflectionMethod=1
r.Shadow.Virtual.Enable=1
r.Lumen.HardwareRayTracing=False
r.DefaultFeature.AutoExposure=True
r.DefaultFeature.AutoExposure.ExtendDefaultLuminanceRange=True

[/Script/Engine.PhysicsSettings]
DefaultGravityZ=-980.0
bSubstepping=True
MaxSubstepDeltaTime=0.008333333
MaxSubsteps=8
"""
INPUT_CONFIG = """[/Script/Engine.InputSettings]
+AxisMappings=(AxisName="KerbsideForward",Scale=1.0,Key=W)
+AxisMappings=(AxisName="KerbsideForward",Scale=-1.0,Key=S)
+AxisMappings=(AxisName="KerbsideForward",Scale=1.0,Key=Up)
+AxisMappings=(AxisName="KerbsideForward",Scale=-1.0,Key=Down)
+AxisMappings=(AxisName="KerbsideRight",Scale=1.0,Key=D)
+AxisMappings=(AxisName="KerbsideRight",Scale=-1.0,Key=A)
+AxisMappings=(AxisName="KerbsideRight",Scale=1.0,Key=Right)
+AxisMappings=(AxisName="KerbsideRight",Scale=-1.0,Key=Left)
+AxisMappings=(AxisName="KerbsideYaw",Scale=1.0,Key=MouseX)
+AxisMappings=(AxisName="KerbsidePitch",Scale=-1.0,Key=MouseY)
"""


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def managed_config(text: str, block: str) -> str:
    if BEGIN in text:
        start = text.index(BEGIN)
        if END not in text[start:]:
            raise ValueError("Malformed managed config; refusing to overwrite")
        stop = text.index(END, start) + len(END)
        text = text[:start] + text[stop:]
    return text.rstrip() + "\n\n" + BEGIN + "\n" + block.rstrip() + "\n" + END + "\n"


def install(project: Path) -> dict:
    project = project.resolve()
    if project.suffix != ".uproject" or not project.is_file():
        raise ValueError("Pass an existing .uproject, not a directory")
    home = project.parent
    registry = home / "Saved/KerbsideInstall/manifest.json"
    previous = json.loads(registry.read_text()) if registry.exists() else {"files": {}}
    plugin = ROOT / "unreal/Plugins/KerbsideWorld"
    copies = {home / "Plugins/KerbsideWorld" / p.relative_to(plugin): p
              for p in plugin.rglob("*") if p.is_file() and p.suffix in {".h", ".cpp", ".cs", ".uplugin"}}
    # The supplied project is currently Blueprint-only. Add a minimal host only if absent.
    host = ROOT / "unreal/Kerbside/Source"
    for source in host.rglob("*"):
        if source.is_file():
            target = home / "Source" / source.relative_to(host)
            if not target.exists() or str(target.relative_to(home)) in previous["files"]:
                copies[target] = source
    for target in copies:
        rel = str(target.relative_to(home))
        if target.exists() and digest(target) != previous["files"].get(rel):
            raise ValueError(f"User-modified/unmanaged source: {target}; refusing overwrite")
    metadata = json.loads(project.read_text())
    modules = metadata.setdefault("Modules", [])
    if not modules:
        modules.append({"Name": "Kerbside", "Type": "Runtime", "LoadingPhase": "Default"})
    plugins = metadata.setdefault("Plugins", [])
    for name in ("KerbsideWorld", "PythonScriptPlugin", "EditorScriptingUtilities", "Interchange", "InterchangeEditor"):
        entry = next((p for p in plugins if p["Name"] == name), None)
        if entry is None:
            plugins.append({"Name": name, "Enabled": True})
        else:
            entry["Enabled"] = True
    backup = home / "Saved/KerbsideInstall/original"
    for target in (project, home / "Config/DefaultEngine.ini", home / "Config/DefaultInput.ini"):
        dest = backup / target.relative_to(home)
        if target.exists() and not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, dest)
    for target, source in copies.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    project.write_text(json.dumps(metadata, indent=2) + "\n")
    for name, block in (("DefaultEngine.ini", ENGINE_CONFIG), ("DefaultInput.ini", INPUT_CONFIG)):
        path = home / "Config" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(managed_config(path.read_text() if path.exists() else "", block))
    result = {"schema_version": 1, "source": str(ROOT), "project": str(project),
              "files": {str(p.relative_to(home)): digest(p) for p in copies}}
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    print(json.dumps(install(args.project), indent=2))
