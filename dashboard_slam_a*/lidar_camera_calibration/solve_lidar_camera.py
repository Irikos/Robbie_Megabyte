#!/usr/bin/env python3
"""Solve livox_frame -> camera_color_optical_frame from captured target planes.

For each new pose, draw a tight rectangle around the calibration board in the
LiDAR spherical range image. Previously accepted selections are cached, so a
later run does not require selecting them again.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import cv2
import numpy as np

from common import (
    BoardSpec,
    camera_board_plane,
    fit_plane_ransac,
    rotation_matrix_to_quaternion,
    solve_plane_extrinsic,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--plane-threshold", type=float, default=0.015,
                        help="LiDAR plane inlier distance in metres")
    parser.add_argument("--min-samples", type=int, default=8)
    parser.add_argument("--min-charuco-corners", type=int, default=8)
    parser.add_argument("--max-range", type=float, default=3.0)
    parser.add_argument("--reselect", action="store_true",
                        help="Ignore cached lidar_plane.json selections")
    return parser.parse_args()


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _camera_parameters(metadata: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    camera = metadata["camera"]
    matrix = np.array([
        [camera["fx"], 0.0, camera["cx"]],
        [0.0, camera["fy"], camera["cy"]],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    distortion = np.asarray(camera.get("distortion", [0, 0, 0, 0, 0]), dtype=np.float64)
    if "inverse_brown" in str(camera.get("distortion_model", "")).lower() \
            and np.any(np.abs(distortion) > 1e-12):
        raise ValueError(
            "Non-zero inverse Brown-Conrady coefficients cannot be passed directly to OpenCV. "
            "Capture a rectified color stream or add the RealSense inverse projection model."
        )
    return matrix, distortion


def _range_panorama(points: np.ndarray, max_range: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build a 1440x720 spherical range view and retain each point's pixel."""
    width, height = 1440, 720
    ranges = np.linalg.norm(points, axis=1)
    valid = np.isfinite(ranges) & (ranges > 0.15) & (ranges <= max_range)
    source_indices = np.flatnonzero(valid)
    selected = points[valid]
    selected_ranges = ranges[valid]
    azimuth = np.arctan2(selected[:, 1], selected[:, 0])
    elevation = np.arctan2(selected[:, 2], np.linalg.norm(selected[:, :2], axis=1))
    px = np.clip(((azimuth + np.pi) / (2.0 * np.pi) * width).astype(np.int32), 0, width - 1)
    py = np.clip(((np.pi / 2.0 - elevation) / np.pi * height).astype(np.int32), 0, height - 1)
    near, far = np.percentile(selected_ranges, [2, 98]) if len(selected_ranges) else (0.0, 1.0)
    scale = np.clip((selected_ranges - near) / max(far - near, 1e-6), 0.0, 1.0)
    colors = cv2.applyColorMap((255.0 * (1.0 - scale)).astype(np.uint8), cv2.COLORMAP_TURBO)
    image = np.full((height, width, 3), 18, dtype=np.uint8)
    # Far points first, so nearer board returns remain visible.
    for index in np.argsort(selected_ranges)[::-1]:
        x, y = int(px[index]), int(py[index])
        image[max(0, y - 1):min(height, y + 2), max(0, x - 1):min(width, x + 2)] = colors[index]
    cv2.putText(image, "Draw a tight box around the physical board, then Enter/Space",
                (15, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    return image, source_indices, np.column_stack((px, py))


def _select_lidar_plane(
    sample_dir: Path, points: np.ndarray, threshold: float, max_range: float
) -> dict[str, Any]:
    panorama, source_indices, pixels = _range_panorama(points, max_range)
    while True:
        roi = cv2.selectROI(f"LiDAR board selection: {sample_dir.name}", panorama,
                            showCrosshair=True, fromCenter=False)
        cv2.destroyWindow(f"LiDAR board selection: {sample_dir.name}")
        x, y, width, height = (int(value) for value in roi)
        if width <= 0 or height <= 0:
            raise KeyboardInterrupt("Selection cancelled")
        mask = ((pixels[:, 0] >= x) & (pixels[:, 0] < x + width)
                & (pixels[:, 1] >= y) & (pixels[:, 1] < y + height))
        point_indices = source_indices[mask]
        try:
            plane = fit_plane_ransac(points[point_indices], threshold_m=threshold)
        except ValueError as exc:
            print(f"{sample_dir.name}: {exc}; select a tighter/better region.")
            continue
        inlier_source_indices = point_indices[plane["inlier_indices"]]
        preview = panorama.copy()
        # Map global point indexes back to the panorama pixel rows.
        source_to_row = {int(source): row for row, source in enumerate(source_indices)}
        for source in inlier_source_indices:
            row = source_to_row.get(int(source))
            if row is not None:
                px, py = pixels[row]
                cv2.circle(preview, (int(px), int(py)), 2, (0, 255, 0), -1)
        cv2.rectangle(preview, (x, y), (x + width, y + height), (255, 255, 255), 2)
        cv2.putText(
            preview,
            f"inliers {plane['inlier_count']}/{plane['selected_count']}  RMS {plane['rms_m']*1000:.1f} mm",
            (15, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA,
        )
        cv2.putText(
            preview, "Y / Enter / Space: accept    R / N: redraw    Q / Esc: stop",
            (15, 84), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA,
        )
        window = f"LiDAR plane check: {sample_dir.name}"
        cv2.imshow(window, preview)
        accepted = False
        while True:
            key = cv2.waitKey(50) & 0xFF
            if key in (ord("y"), ord("Y"), 13, 10, ord(" ")):
                accepted = True
                break
            if key in (ord("r"), ord("R"), ord("n"), ord("N")):
                break
            if key in (ord("q"), ord("Q"), 27):
                cv2.destroyWindow(window)
                raise KeyboardInterrupt("Calibration stopped")
        cv2.destroyWindow(window)
        if accepted:
            cv2.imwrite(str(sample_dir / "lidar_selection.png"), preview)
            return {
                "normal": plane["normal"].tolist(),
                "d": float(plane["d"]),
                "centroid": plane["centroid"].tolist(),
                "inlier_count": plane["inlier_count"],
                "selected_count": plane["selected_count"],
                "rms_m": plane["rms_m"],
                "roi": [x, y, width, height],
            }


def _write_extrinsic_yaml(path: Path, result: dict[str, Any], quaternion: np.ndarray,
                          sample_names: list[str]) -> None:
    rotation = result["rotation"]
    translation = result["translation"]
    lines = [
        "# x_camera = R_camera_livox * x_livox + t_camera_livox",
        "parent_frame: livox_frame",
        "child_frame: camera_color_optical_frame",
        "translation_m: [" + ", ".join(f"{v:.10g}" for v in translation) + "]",
        "quaternion_xyzw: [" + ", ".join(f"{v:.10g}" for v in quaternion) + "]",
        "rotation_matrix:",
    ]
    lines.extend("  - [" + ", ".join(f"{v:.10g}" for v in row) + "]" for row in rotation)
    lines.extend([
        f"normal_rms_deg: {result['normal_rms_deg']:.8g}",
        f"distance_rms_m: {result['distance_rms_m']:.8g}",
        f"translation_condition: {result['translation_condition']:.8g}",
        "samples:",
    ])
    lines.extend(f"  - {name}" for name in sample_names)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _validation_overlay(sample_dir: Path, points: np.ndarray, matrix: np.ndarray,
                        distortion: np.ndarray, rotation: np.ndarray,
                        translation: np.ndarray) -> None:
    image = cv2.imread(str(sample_dir / "color.png"), cv2.IMREAD_COLOR)
    if image is None:
        return
    if len(points) > 120_000:
        points = points[np.linspace(0, len(points) - 1, 120_000, dtype=np.int64)]
    camera_points = points.astype(np.float64) @ rotation.T + translation
    valid = camera_points[:, 2] > 0.15
    camera_points = camera_points[valid]
    if not len(camera_points):
        return
    pixels, _ = cv2.projectPoints(
        camera_points, np.zeros(3), np.zeros(3), matrix, distortion
    )
    pixels = np.rint(pixels.reshape(-1, 2)).astype(np.int32)
    height, width = image.shape[:2]
    inside = ((pixels[:, 0] >= 0) & (pixels[:, 0] < width)
              & (pixels[:, 1] >= 0) & (pixels[:, 1] < height))
    pixels = pixels[inside]
    depths = camera_points[inside, 2]
    colors = cv2.applyColorMap(
        np.clip((depths / 3.0) * 255.0, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO
    ).reshape(-1, 3)
    for (x, y), color in zip(pixels, colors):
        cv2.circle(image, (int(x), int(y)), 1, tuple(int(v) for v in color), -1)
    cv2.imwrite(str(sample_dir / "projection_validation.png"), image)


def main() -> int:
    args = parse_args()
    sample_dirs = sorted(path for path in args.dataset.glob("pose_*") if path.is_dir())
    if not sample_dirs:
        raise SystemExit(f"No pose_* captures found in {args.dataset}")
    records = []
    try:
        for sample_dir in sample_dirs:
            metadata = _load_json(sample_dir / "metadata.json")
            board = BoardSpec(**metadata["board"])
            image = cv2.imread(str(sample_dir / "color.png"), cv2.IMREAD_COLOR)
            if image is None:
                print(f"Skipping {sample_dir.name}: color.png cannot be read")
                continue
            matrix, distortion = _camera_parameters(metadata)
            try:
                camera_plane = camera_board_plane(
                    image, matrix, distortion, board, args.min_charuco_corners
                )
            except ValueError as exc:
                print(f"Skipping {sample_dir.name}: {exc}")
                continue
            cloud = np.load(sample_dir / "lidar_frames.npz")
            points = np.asarray(cloud["points"], dtype=np.float32)
            plane_path = sample_dir / "lidar_plane.json"
            if plane_path.exists() and not args.reselect:
                lidar_plane = _load_json(plane_path)
                print(f"{sample_dir.name}: reused cached LiDAR selection")
            else:
                lidar_plane = _select_lidar_plane(
                    sample_dir, points, args.plane_threshold, args.max_range
                )
                write_json(plane_path, lidar_plane)
            camera_serializable = {
                "normal": camera_plane["normal"].tolist(),
                "d": float(camera_plane["d"]),
                "corner_count": camera_plane["corner_count"],
                "reprojection_rms_px": camera_plane["reprojection_rms_px"],
            }
            write_json(sample_dir / "camera_plane.json", camera_serializable)
            print(f"{sample_dir.name}: camera RMS {camera_plane['reprojection_rms_px']:.2f}px, "
                  f"LiDAR RMS {lidar_plane['rms_m']*1000:.1f}mm")
            records.append((sample_dir, points, matrix, distortion,
                            camera_serializable, lidar_plane))
    except KeyboardInterrupt:
        print("\nCalibration selection cancelled.")
        return 130
    finally:
        cv2.destroyAllWindows()

    if len(records) < args.min_samples:
        raise SystemExit(
            f"Only {len(records)} usable poses; collect at least {args.min_samples} "
            "with substantially different board angles."
        )
    result = solve_plane_extrinsic(
        [record[5]["normal"] for record in records],
        [record[5]["d"] for record in records],
        [record[4]["normal"] for record in records],
        [record[4]["d"] for record in records],
    )
    quaternion = rotation_matrix_to_quaternion(result["rotation"])
    output_path = args.dataset / "lidar_to_camera.yaml"
    _write_extrinsic_yaml(output_path, result, quaternion,
                          [record[0].name for record in records])
    diagnostics = {
        "normal_errors_deg": result["normal_errors_deg"].tolist(),
        "distance_errors_m": result["distance_errors_m"].tolist(),
        "normal_rms_deg": result["normal_rms_deg"],
        "distance_rms_m": result["distance_rms_m"],
        "translation_condition": result["translation_condition"],
    }
    write_json(args.dataset / "calibration_diagnostics.json", diagnostics)
    for sample_dir, points, matrix, distortion, _, _ in records:
        _validation_overlay(
            sample_dir, points, matrix, distortion,
            result["rotation"], result["translation"],
        )
    print(f"\nSaved transform: {output_path}")
    print(f"Normal RMS: {result['normal_rms_deg']:.3f} deg")
    print(f"Plane-distance RMS: {result['distance_rms_m']*1000:.2f} mm")
    print("Inspect every pose_*/projection_validation.png before using this transform.")
    if result["translation_condition"] > 50.0:
        print("WARNING: weak translation geometry; collect more strongly tilted board poses.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

