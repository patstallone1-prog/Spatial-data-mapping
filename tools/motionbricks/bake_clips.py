#!/usr/bin/env python3
"""Bake the walker's gait from NVIDIA MotionBricks: idle, slow walk, walk and jog, as loops.

MotionBricks (NVlabs/GR00T-WholeBodyControl, ``motionbricks/``; code Apache-2.0, weights under the
NVIDIA Open Model License) generates motion for the Unitree G1 humanoid in real time from a
direction and a mode. Its runtime is PyTorch and wants CUDA; the page is a browser, so the
motion is generated here, offline -- on the CPU (the model's float64 buffers rule out the Mac's
GPU backend) -- and shipped as clips.

For each mode the generator is driven straight ahead for a while, the steady stretch is cut to
one gait cycle that loops (the pair of frames furthest apart in time whose poses match best),
and what is kept per frame is the G1's joint positions relative to its pelvis, in metres and in
the page's axes (x right, y up, z forward), plus the pelvis height. The page retargets those
onto its own character by matching each limb's direction (see the renderer, motionBricks).

    MOTIONBRICKS_DIR=../vendor/GR00T-WholeBodyControl/motionbricks \\
      ../vendor/GR00T-WholeBodyControl/motionbricks/.venv-mb/bin/python tools/motionbricks/bake_clips.py

Writes docs/sf-corridor-motionbricks.json (the sf-corridor- prefix is what tools/build_pages.py publishes).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
MB = Path(os.environ.get("MOTIONBRICKS_DIR", ROOT.parent / "vendor" / "GR00T-WholeBodyControl" / "motionbricks"))
sys.path.insert(0, str(MB))
os.chdir(MB)  # the package resolves its assets and checkpoints from here

import mujoco  # noqa: E402
import torch as t  # noqa: E402

# The model loader selects a CUDA device unconditionally; there is none here, and nothing else
# it does needs one. Everything is placed on the device this script chooses instead.
t.cuda.set_device = lambda *args, **kwargs: None
# And its checkpoints were saved from CUDA tensors: they are read onto the CPU first.
_load = t.load
t.load = lambda *args, **kwargs: _load(*args, **{**kwargs, "map_location": "cpu"})

#: The G1 bodies the page's character is driven from, by the name the page uses for each.
JOINTS = {
    "pelvis": "pelvis", "torso": "torso_link",
    "l_hip": "left_hip_roll_link", "l_knee": "left_knee_link", "l_ankle": "left_ankle_roll_link",
    "r_hip": "right_hip_roll_link", "r_knee": "right_knee_link", "r_ankle": "right_ankle_roll_link",
    "l_shoulder": "left_shoulder_roll_link", "l_elbow": "left_elbow_link", "l_wrist": "left_wrist_yaw_link",
    "r_shoulder": "right_shoulder_roll_link", "r_elbow": "right_elbow_link", "r_wrist": "right_wrist_yaw_link",
}
#: Modes to bake, with the scripted keys that select them in MotionBricks' WASD controller.
MODES = {
    "idle": {"keys": {}, "speed": [1.0, 1.0]},
    "slow_walk": {"keys": {"w": True, "v": True}, "speed": [1.0, 1.0]},
    "walk": {"keys": {"w": True}, "speed": [1.0, 1.0]},
    "jog": {"keys": {"w": True}, "speed": [1.5, 1.5]},
}
FPS = 30
KEYS = ['w', 'a', 's', 'd', 'left', 'right', 'up', 'down', 'shift', 'ctrl', 'enter',
        'x', 'z', 'c', 'v', 'b', 'r', 't', 'f', 'g', 'q', 'e']


def device() -> str:
    # Not MPS: the model keeps float64 buffers, which Apple's GPU backend does not support.
    return "cuda" if t.cuda.is_available() else "cpu"


def build(dev: str, speed: list[float]):
    from motionbricks.exp_setup.experiment import test
    from motionbricks.motion_backbone.demo.controllers import WASD_controller
    from motionbricks.motion_backbone.demo.full_agent import full_navigation_agent
    from motionbricks.motion_backbone.demo.utils import build_mj_simulator
    from motionbricks.motion_backbone.inference.motion_inference import motion_inference

    args = SimpleNamespace(
        result_dir=str(MB / "out"), data_root=str(MB / "datasets"), explicit_dataset_folder=None,
        EXP="default", return_model_configs=True, return_dataloader=False, clips="G1")
    models, confs = test(args)
    for name in ("pose", "root"):
        state = t.load(confs[name].ckpt_path, map_location="cpu")["state_dict"]
        models[name].load_state_dict(state)
    inferencer = motion_inference(models, models["pose"].args, device=dev)
    agent = full_navigation_agent(
        inferencer, None, device=dev, speed_scale=speed, target_root_realignment=True,
        source_root_realignment=True, force_canonicalization=True,
        skeleton_xml=str(MB / "assets" / "skeletons" / "g1" / "g1.xml"),
        skip_ending_target_cond=False, filter_qpos=True, clips="G1",
        ckpt_path=str(MB / "out" / "G1-clip.ckpt"), reprocess_clips=False,
        val_dataloader=None).to(dev)
    controller = WASD_controller(lookat_movement_direction=True, clips="G1",
                                 min_token=inferencer._args["min_tokens"],
                                 max_token=inferencer._args["max_tokens"])
    mj_model, mj_data = build_mj_simulator(str(MB / "assets" / "skeletons" / "g1" / "scene_29dof.xml"), FPS)
    return agent, controller, mj_model, mj_data


def run_mode(agent, controller, mj_model, mj_data, keys: dict, frames: int, warmup: int):
    # A camera looking along +x, which the controller reads "forward" from.
    viewer = SimpleNamespace(cam=SimpleNamespace(lookat=np.array([0.0, 0.0, 0.8]), distance=3.0,
                                                 azimuth=180.0, elevation=-20.0))
    body = {k: mujoco.mj_name2id(mj_model, mujoco.mjtObj.mjOBJ_BODY, v) for k, v in JOINTS.items()}
    agent.reset()
    controller.reset()
    out_pos, out_root = [], []
    for step in range(warmup + frames):
        qpos = agent.get_next_frame()
        mj_data.qpos[:] = qpos
        mujoco.mj_forward(mj_model, mj_data)
        pressed = {k: False for k in KEYS}
        if step >= warmup // 3:
            pressed.update(keys)
        signals = controller.generate_control_signals(
            viewer, mj_model, mj_data, visualize=False,
            control_info={"force_idle": False, "allowed_mode": None, "key_pressed": pressed})
        signals["context_mujoco_qpos"] = agent.get_context_mujoco_qpos()
        with t.no_grad():
            agent.generate_new_frames(signals, controller.get_controller_dt() * 2.0)
        if step >= warmup:
            out_pos.append(np.array([mj_data.xpos[body[k]] for k in JOINTS]))
            out_root.append(np.array(mj_data.xquat[body["pelvis"]]))
    return np.array(out_pos), np.array(out_root)


def to_page_frame(pos: np.ndarray) -> np.ndarray:
    """MuJoCo z-up, x forward, y left -> page y-up, z forward, x right... relative to the pelvis,
    with the heading taken out so the clip walks straight along +z."""
    pelvis = pos[:, 0:1, :]
    rel = pos - pelvis * np.array([1, 1, 0])          # keep the pelvis height, drop its travel
    # Heading per frame from the hips (left - right), smoothed: the clip is put on +z.
    side = pos[:, JOINTS_INDEX["l_hip"]] - pos[:, JOINTS_INDEX["r_hip"]]
    yaw = np.unwrap(np.arctan2(side[:, 1], side[:, 0]) - np.pi / 2)
    yaw = np.convolve(yaw, np.ones(15) / 15, mode="same")
    c, s = np.cos(-yaw)[:, None], np.sin(-yaw)[:, None]
    x, y, z = rel[..., 0], rel[..., 1], rel[..., 2]
    fwd = c * x - s * y                                # along the heading
    left = s * x + c * y
    return np.stack([-left, z, fwd], axis=-1)          # page: x right, y up, z forward


JOINTS_INDEX = {k: i for i, k in enumerate(JOINTS)}


def loop_of(frames: np.ndarray, min_len: int, max_len: int) -> tuple[int, int, float]:
    """The longest stretch [a, b) whose first and last poses match best: one gait cycle."""
    best = (0, min_len, np.inf)
    n = len(frames)
    flat = frames.reshape(n, -1)
    for a in range(0, max(1, n - max_len)):
        for b in range(a + min_len, min(n, a + max_len)):
            d = float(np.linalg.norm(flat[a] - flat[b]))
            if d < best[2]:
                best = (a, b, d)
    return best


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--frames", type=int, default=240)
    ap.add_argument("--warmup", type=int, default=90)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "sf-corridor-motionbricks.json")
    args = ap.parse_args()
    dev = device()
    clips = {}
    for name, spec in MODES.items():
        started = time.time()
        agent, controller, mj_model, mj_data = build(dev, spec["speed"])
        pos, _quat = run_mode(agent, controller, mj_model, mj_data, spec["keys"], args.frames,
                              args.warmup)
        travel = float(np.linalg.norm(pos[-1, 0, :2] - pos[0, 0, :2]) / (len(pos) / FPS))
        page = to_page_frame(pos)
        a, b, err = loop_of(page, 20 if name != "idle" else 45, 50 if name != "idle" else 120)
        cycle = page[a:b]
        clips[name] = {
            "fps": FPS, "frames": len(cycle), "speed_m_s": round(travel, 3),
            "loop_error_m": round(err / np.sqrt(cycle.shape[1]), 4),
            "pelvis_height_m": round(float(np.median(cycle[:, 0, 1])), 3),
            "positions": np.round(cycle, 4).reshape(len(cycle), -1).tolist(),
        }
        print(f"{name}: {len(cycle)} frames, {travel:.2f} m/s, loop error "
              f"{clips[name]['loop_error_m']} m, {time.time() - started:.0f} s on {dev}", flush=True)
    payload = {
        "source": "NVIDIA MotionBricks (NVlabs/GR00T-WholeBodyControl), Unitree G1 skeleton; "
                  "code Apache-2.0, weights NVIDIA Open Model License",
        "generated_on": dev, "joints": list(JOINTS), "clips": clips,
    }
    args.out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
