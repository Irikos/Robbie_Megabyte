#!/usr/bin/env python3
"""Colorize one captured Mid-360 cloud with its aligned RealSense frame."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any

import cv2
import numpy as np

from common import write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("pose", help="Capture directory, for example pose_001")
    parser.add_argument("--extrinsic", type=Path,
                        help="Defaults to DATASET/lidar_to_camera.yaml")
    parser.add_argument("--output", type=Path,
                        help="Defaults to DATASET/POSE/colorized")
    parser.add_argument("--voxel-size", type=float, default=0.01,
                        help="Final RGB voxel size in metres; 0 keeps every colored point")
    parser.add_argument("--depth-absolute-tolerance", type=float, default=0.08,
                        help="Minimum occlusion tolerance in metres")
    parser.add_argument("--depth-relative-tolerance", type=float, default=0.03,
                        help="Additional tolerance as a fraction of camera depth")
    parser.add_argument("--allow-missing-depth", action="store_true",
                        help="Color in-view points when RealSense depth is invalid")
    return parser.parse_args()


def load_extrinsic(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Read the deliberately small YAML format emitted by the solver."""
    text = path.read_text(encoding="utf-8")
    translation_match = re.search(r"^translation_m:\s*\[([^]]+)\]", text, re.MULTILINE)
    matrix_match = re.search(
        r"^rotation_matrix:\s*\n((?:\s+-\s*\[[^\n]+\]\s*\n?){3})", text, re.MULTILINE
    )
    if translation_match is None or matrix_match is None:
        raise ValueError(f"Could not read translation/rotation from {path}")
    translation = np.fromstring(translation_match.group(1), sep=",", dtype=np.float64)
    rows = []
    for row in re.findall(r"\[([^]]+)\]", matrix_match.group(1)):
        rows.append(np.fromstring(row, sep=",", dtype=np.float64))
    rotation = np.asarray(rows, dtype=np.float64)
    if translation.shape != (3,) or rotation.shape != (3, 3):
        raise ValueError(f"Invalid transform dimensions in {path}")
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-4):
        raise ValueError(f"Rotation matrix in {path} is not orthonormal")
    return rotation, translation


def load_camera(metadata: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    camera = metadata["camera"]
    matrix = np.array([
        [camera["fx"], 0.0, camera["cx"]],
        [0.0, camera["fy"], camera["cy"]],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    distortion = np.asarray(camera.get("distortion", [0, 0, 0, 0, 0]), dtype=np.float64)
    model = str(camera.get("distortion_model", "")).lower()
    if "inverse_brown" in model and np.any(np.abs(distortion) > 1e-12):
        raise ValueError(
            "Non-zero inverse Brown-Conrady coefficients require RealSense-specific projection."
        )
    return matrix, distortion


def project_points(camera_points: np.ndarray, matrix: np.ndarray,
                   distortion: np.ndarray) -> np.ndarray:
    if np.all(np.abs(distortion) <= 1e-12):
        pixels = np.empty((len(camera_points), 2), dtype=np.float64)
        pixels[:, 0] = matrix[0, 0] * camera_points[:, 0] / camera_points[:, 2] + matrix[0, 2]
        pixels[:, 1] = matrix[1, 1] * camera_points[:, 1] / camera_points[:, 2] + matrix[1, 2]
        return pixels
    pixels, _ = cv2.projectPoints(
        camera_points, np.zeros(3), np.zeros(3), matrix, distortion
    )
    return pixels.reshape(-1, 2)


def fuse_colored_voxels(points: np.ndarray, colors: np.ndarray,
                        voxel_size: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if voxel_size <= 0.0 or not len(points):
        return points.astype(np.float32), colors.astype(np.uint8), np.ones(len(points), np.int32)
    keys = np.floor(points / voxel_size).astype(np.int32)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    count = np.bincount(inverse).astype(np.int32)
    fused_points = np.column_stack([
        np.bincount(inverse, weights=points[:, axis]) / count for axis in range(3)
    ]).astype(np.float32)
    fused_colors = np.column_stack([
        np.bincount(inverse, weights=colors[:, axis]) / count for axis in range(3)
    ])
    return fused_points, np.clip(np.rint(fused_colors), 0, 255).astype(np.uint8), count


def write_binary_pcd(path: Path, points: np.ndarray, colors_rgb: np.ndarray) -> None:
    """Write PCD 0.7 with packed uint32 RGB and LiDAR-frame XYZ."""
    cloud = np.empty(len(points), dtype=np.dtype([
        ("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("rgb", "<u4")
    ]))
    cloud["x"], cloud["y"], cloud["z"] = points[:, 0], points[:, 1], points[:, 2]
    rgb = colors_rgb.astype(np.uint32)
    cloud["rgb"] = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
    header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\nFIELDS x y z rgb\nSIZE 4 4 4 4\n"
        "TYPE F F F U\nCOUNT 1 1 1 1\n"
        f"WIDTH {len(points)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {len(points)}\nDATA binary\n"
    ).encode("ascii")
    with path.open("wb") as stream:
        stream.write(header)
        stream.write(cloud.tobytes())


def write_binary_ply(path: Path, points: np.ndarray, colors_rgb: np.ndarray) -> None:
    cloud = np.empty(len(points), dtype=np.dtype([
        ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
        ("red", "u1"), ("green", "u1"), ("blue", "u1"),
    ]))
    cloud["x"], cloud["y"], cloud["z"] = points[:, 0], points[:, 1], points[:, 2]
    cloud["red"], cloud["green"], cloud["blue"] = (
        colors_rgb[:, 0], colors_rgb[:, 1], colors_rgb[:, 2]
    )
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(points)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode("ascii")
    with path.open("wb") as stream:
        stream.write(header)
        stream.write(cloud.tobytes())


def make_overlay(image: np.ndarray, pixels: np.ndarray, depths: np.ndarray,
                 output: Path) -> None:
    overlay = image.copy()
    if not len(pixels):
        cv2.imwrite(str(output), overlay)
        return
    if len(pixels) > 50_000:
        indices = np.linspace(0, len(pixels) - 1, 50_000, dtype=np.int64)
        pixels, depths = pixels[indices], depths[indices]
    near, far = np.percentile(depths, [2, 98]) if len(depths) else (0.0, 1.0)
    normalized = np.clip((depths - near) / max(far - near, 1e-6), 0.0, 1.0)
    colors = cv2.applyColorMap(
        np.rint(normalized * 255).astype(np.uint8), cv2.COLORMAP_TURBO
    ).reshape(-1, 3)
    for (u, v), color in zip(pixels, colors):
        cv2.circle(overlay, (int(u), int(v)), 1, tuple(int(x) for x in color), -1)
    cv2.imwrite(str(output), overlay)


def colorize(args: argparse.Namespace) -> dict[str, Any]:
    sample = args.dataset / args.pose
    if not sample.is_dir():
        raise FileNotFoundError(f"Capture does not exist: {sample}")
    extrinsic = args.extrinsic or args.dataset / "lidar_to_camera.yaml"
    output = args.output or sample / "colorized"
    output.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((sample / "metadata.json").read_text(encoding="utf-8"))
    matrix, distortion = load_camera(metadata)
    rotation, translation = load_extrinsic(extrinsic)
    image = cv2.imread(str(sample / "color.png"), cv2.IMREAD_COLOR)
    depth_mm = cv2.imread(str(sample / "depth_mm.png"), cv2.IMREAD_UNCHANGED)
    if image is None or depth_mm is None:
        raise ValueError(f"Could not read color/depth images in {sample}")
    cloud = np.load(sample / "lidar_frames.npz")
    lidar_points = np.asarray(cloud["points"], dtype=np.float64).reshape(-1, 3)

    camera_points = lidar_points @ rotation.T + translation
    in_front = camera_points[:, 2] > 0.15
    front_indices = np.flatnonzero(in_front)
    front_camera = camera_points[in_front]
    pixels_float = project_points(front_camera, matrix, distortion)
    pixels = np.rint(pixels_float).astype(np.int32)
    height, width = image.shape[:2]
    inside = ((pixels[:, 0] >= 0) & (pixels[:, 0] < width)
              & (pixels[:, 1] >= 0) & (pixels[:, 1] < height))
    inside_indices = front_indices[inside]
    pixels_inside = pixels[inside]
    camera_inside = front_camera[inside]
    sampled_depth = depth_mm[pixels_inside[:, 1], pixels_inside[:, 0]].astype(np.float64) / 1000.0
    depth_valid = sampled_depth > 0.0
    tolerance = np.maximum(
        args.depth_absolute_tolerance,
        args.depth_relative_tolerance * camera_inside[:, 2],
    )
    depth_consistent = np.abs(sampled_depth - camera_inside[:, 2]) <= tolerance
    accepted = depth_consistent | (~depth_valid & args.allow_missing_depth)
    accepted_indices = inside_indices[accepted]
    accepted_pixels = pixels_inside[accepted]
    accepted_camera = camera_inside[accepted]
    colors_bgr = image[accepted_pixels[:, 1], accepted_pixels[:, 0]]
    colors_rgb = colors_bgr[:, ::-1]
    colored_points = lidar_points[accepted_indices]
    fused_points, fused_colors, observations = fuse_colored_voxels(
        colored_points, colors_rgb, args.voxel_size
    )
    write_binary_pcd(output / "cloud_xyzrgb.pcd", fused_points, fused_colors)
    write_binary_ply(output / "cloud_xyzrgb.ply", fused_points, fused_colors)
    make_overlay(image, accepted_pixels, accepted_camera[:, 2], output / "projection_overlay.png")
    stats = {
        "pose": args.pose,
        "coordinate_frame": "livox_frame",
        "extrinsic": str(extrinsic),
        "input_points": int(len(lidar_points)),
        "in_front_of_camera": int(in_front.sum()),
        "inside_image": int(inside.sum()),
        "valid_depth": int(depth_valid.sum()),
        "depth_consistent": int(depth_consistent.sum()),
        "accepted_colored_observations": int(len(colored_points)),
        "output_voxels": int(len(fused_points)),
        "mean_observations_per_voxel": float(observations.mean()) if len(observations) else 0.0,
        "voxel_size_m": args.voxel_size,
        "depth_absolute_tolerance_m": args.depth_absolute_tolerance,
        "depth_relative_tolerance": args.depth_relative_tolerance,
        "allow_missing_depth": args.allow_missing_depth,
    }
    write_json(output / "colorization_stats.json", stats)
    return stats


def main() -> int:
    args = parse_args()
    stats = colorize(args)
    print(json.dumps(stats, indent=2))
    output = args.output or args.dataset / args.pose / "colorized"
    print(f"\nSaved XYZRGB PCD, PLY, overlay, and statistics in {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
