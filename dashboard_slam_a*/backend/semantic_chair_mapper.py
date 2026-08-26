"""Calibrated RealSense depth extraction and persistent semantic chair tracks."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional
import ast
import json
import math
import re
import time

import numpy as np


@dataclass(frozen=True)
class LidarCameraCalibration:
    """Calibration with p_camera = R_camera_livox * p_livox + t."""

    rotation_camera_livox: np.ndarray
    translation_camera_livox: np.ndarray
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    depth_scale_m: float

    @classmethod
    def load(cls, calibration_dir: Path) -> "LidarCameraCalibration":
        calibration_dir = Path(calibration_dir)
        transform_path = calibration_dir / "data" / "lidar_to_camera.yaml"
        text = transform_path.read_text(encoding="utf-8")
        translation_match = re.search(r"^translation_m:\s*(\[[^\n]+\])", text, re.MULTILINE)
        rotation_match = re.search(
            r"^rotation_matrix:\s*\n((?:\s*-\s*\[[^\n]+\]\s*\n?){3})",
            text,
            re.MULTILINE,
        )
        if not translation_match or not rotation_match:
            raise ValueError(f"Transformare incompletă în {transform_path}")
        translation = np.asarray(
            ast.literal_eval(translation_match.group(1)), dtype=np.float64
        ).reshape(3)
        rows = re.findall(r"-\s*(\[[^\n]+\])", rotation_match.group(1))
        rotation = np.asarray([ast.literal_eval(row) for row in rows], dtype=np.float64)
        if rotation.shape != (3, 3):
            raise ValueError("rotation_matrix trebuie să fie 3x3")

        metadata_paths = sorted((calibration_dir / "data").glob("pose_*/metadata.json"))
        if not metadata_paths:
            raise ValueError("Nu există metadata pentru intrinsecii RealSense")
        metadata = json.loads(metadata_paths[0].read_text(encoding="utf-8"))
        camera = metadata["camera"]
        if not camera.get("depth_aligned_to_color"):
            raise ValueError("Depth-ul calibrării nu este aliniat la color")
        return cls(
            rotation_camera_livox=rotation,
            translation_camera_livox=translation,
            fx=float(camera["fx"]),
            fy=float(camera["fy"]),
            cx=float(camera["cx"]),
            cy=float(camera["cy"]),
            width=int(camera["width"]),
            height=int(camera["height"]),
            depth_scale_m=float(camera["depth_scale_m"]),
        )

    def camera_to_livox(self, camera_points: np.ndarray) -> np.ndarray:
        points = np.asarray(camera_points, dtype=np.float64).reshape(-1, 3)
        # Column form: p_livox = R.T @ (p_camera - t).
        # Points are rows here, therefore right-multiply by R.
        return (points - self.translation_camera_livox) @ self.rotation_camera_livox


def canonical_chair_label(label: str) -> Optional[str]:
    return "chair" if str(label).strip().lower() in {"chair", "toilet"} else None


def deduplicate_chair_detections(
    detections: Iterable[dict],
    minimum_confidence: float = 0.35,
    iou_threshold: float = 0.35,
) -> list[dict]:
    """Class-independent NMS so chair+toilet boxes become one chair."""
    candidates = [
        detection for detection in detections
        if canonical_chair_label(detection.get("label", ""))
        and float(detection.get("confidence", 0.0)) >= minimum_confidence
    ]
    candidates.sort(
        key=lambda detection: float(detection.get("confidence", 0.0)),
        reverse=True,
    )
    kept = []
    for candidate in candidates:
        x1 = float(candidate.get("x1", 0.0))
        y1 = float(candidate.get("y1", 0.0))
        x2 = float(candidate.get("x2", 0.0))
        y2 = float(candidate.get("y2", 0.0))
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        overlaps = False
        for previous in kept:
            px1 = float(previous.get("x1", 0.0))
            py1 = float(previous.get("y1", 0.0))
            px2 = float(previous.get("x2", 0.0))
            py2 = float(previous.get("y2", 0.0))
            intersection = (
                max(0.0, min(x2, px2) - max(x1, px1))
                * max(0.0, min(y2, py2) - max(y1, py1))
            )
            previous_area = max(0.0, px2 - px1) * max(0.0, py2 - py1)
            union = area + previous_area - intersection
            if union > 0.0 and intersection / union >= iou_threshold:
                overlaps = True
                break
        if not overlaps:
            kept.append(candidate)
    return kept


def extract_livox_points(
    depth_img: np.ndarray,
    color_img: np.ndarray,
    detection: dict,
    calibration: LidarCameraCalibration,
    sample_step: int = 3,
) -> list[dict]:
    """Extract foreground points in a YOLO box and return them in livox_frame.

    YOLO runs on the horizontally flipped display image. Depth and calibration
    use the raw, unmirrored color frame, so the box is unflipped here.
    """
    if depth_img is None or color_img is None or depth_img.ndim != 2:
        return []
    height, width = depth_img.shape
    if color_img.shape[:2] != (height, width):
        return []

    flipped_x1 = int(detection.get("x1", 0))
    flipped_x2 = int(detection.get("x2", 0))
    y1 = max(0, min(height - 1, int(detection.get("y1", 0))))
    y2 = max(0, min(height, int(detection.get("y2", 0))))
    raw_x1 = max(0, min(width - 1, width - flipped_x2))
    raw_x2 = max(0, min(width, width - flipped_x1))
    if raw_x2 - raw_x1 < 8 or y2 - y1 < 8:
        return []

    # Remove a thin border where YOLO boxes most often include background.
    margin_x = max(1, int((raw_x2 - raw_x1) * 0.04))
    margin_y = max(1, int((y2 - y1) * 0.03))
    raw_x1 += margin_x
    raw_x2 -= margin_x
    y1 += margin_y
    y2 -= margin_y
    if raw_x2 <= raw_x1 or y2 <= y1:
        return []

    vv, uu = np.mgrid[
        y1:y2:max(1, int(sample_step)),
        raw_x1:raw_x2:max(1, int(sample_step)),
    ]
    depth_m = depth_img[vv, uu].astype(np.float64) * calibration.depth_scale_m
    valid = np.isfinite(depth_m) & (depth_m >= 0.25) & (depth_m <= 4.0)
    if int(valid.sum()) < 20:
        return []

    valid_depth = depth_m[valid]
    foreground_depth = float(np.percentile(valid_depth, 20.0))
    # Chairs contain holes and several depth layers. Keep the foreground body
    # while excluding the wall/floor commonly visible through the box.
    foreground = (
        valid
        & (depth_m >= max(0.25, foreground_depth - 0.20))
        & (depth_m <= foreground_depth + 0.75)
    )
    if int(foreground.sum()) < 20:
        return []

    u = uu[foreground].astype(np.float64)
    v = vv[foreground].astype(np.float64)
    z = depth_m[foreground]
    scale_x = width / float(calibration.width)
    scale_y = height / float(calibration.height)
    fx = calibration.fx * scale_x
    fy = calibration.fy * scale_y
    cx = calibration.cx * scale_x
    cy = calibration.cy * scale_y
    camera_points = np.column_stack((
        (u - cx) * z / fx,
        (v - cy) * z / fy,
        z,
    ))
    livox_points = calibration.camera_to_livox(camera_points)
    colors = color_img[v.astype(np.int32), u.astype(np.int32)]
    output = []
    for point, bgr in zip(livox_points, colors):
        if not np.isfinite(point).all():
            continue
        output.append({
            "x": float(point[0]),
            "y": float(point[1]),
            "z": float(point[2]),
            "r": int(bgr[2]),
            "g": int(bgr[1]),
            "b": int(bgr[0]),
        })
    return output


class SemanticChairTracker:
    """Multi-frame spatial tracker with stable chair numbering."""

    def __init__(
        self,
        confirmations: int = 3,
        merge_distance_m: float = 0.70,
        voxel_size_m: float = 0.025,
        lifespan_s: float = 30.0,
        max_voxels: int = 10000,
    ):
        self.confirmations = max(1, int(confirmations))
        self.merge_distance_m = float(merge_distance_m)
        self.voxel_size_m = float(voxel_size_m)
        self.lifespan_s = max(1.0, float(lifespan_s))
        self.max_voxels = max(100, int(max_voxels))
        self._tracks: list[dict] = []
        self._next_id = 1

    def reset(self) -> None:
        self._tracks = []
        self._next_id = 1

    def expire(self, observed_at: Optional[float] = None) -> bool:
        """Remove candidates after 2 s and confirmed chairs after lifespan_s."""
        now = float(time.monotonic() if observed_at is None else observed_at)
        previous_count = len(self._tracks)
        self._tracks = [
            track for track in self._tracks
            if now - track["last_seen"] <= (
                self.lifespan_s if track["id"] is not None else 2.0
            )
        ]
        return len(self._tracks) != previous_count

    def observe(
        self,
        points: Iterable[dict],
        confidence: float,
        observed_at: Optional[float] = None,
    ) -> bool:
        points = list(points)
        if len(points) < 20:
            return False
        now = float(time.monotonic() if observed_at is None else observed_at)
        xyz = np.asarray(
            [[point["x"], point["y"], point["z"]] for point in points],
            dtype=np.float64,
        )
        finite = np.isfinite(xyz).all(axis=1)
        xyz = xyz[finite]
        points = [point for point, keep in zip(points, finite) if keep]
        if len(points) < 20:
            return False
        center = np.median(xyz, axis=0)

        self.expire(now)
        track = None
        best_distance = math.inf
        for candidate in self._tracks:
            distance = math.hypot(
                float(center[0]) - candidate["center"][0],
                float(center[1]) - candidate["center"][1],
            )
            if distance <= self.merge_distance_m and distance < best_distance:
                track = candidate
                best_distance = distance
        if track is None:
            track = {
                "id": None,
                "hits": 0,
                "center": center.tolist(),
                "last_seen": now,
                "confidence": 0.0,
                "voxels": {},
            }
            self._tracks.append(track)

        track["hits"] += 1
        track["last_seen"] = now
        track["confidence"] = max(float(confidence), track["confidence"])
        previous = np.asarray(track["center"], dtype=np.float64)
        track["center"] = (previous * 0.75 + center * 0.25).tolist()
        for point in points:
            key = (
                round(float(point["x"]) / self.voxel_size_m),
                round(float(point["y"]) / self.voxel_size_m),
                round(float(point["z"]) / self.voxel_size_m),
            )
            if key not in track["voxels"] and len(track["voxels"]) < self.max_voxels:
                track["voxels"][key] = {
                    "x": round(float(point["x"]), 4),
                    "y": round(float(point["y"]), 4),
                    "z": round(float(point["z"]), 4),
                    "r": int(point.get("r", 180)),
                    "g": int(point.get("g", 180)),
                    "b": int(point.get("b", 180)),
                }
        became_confirmed = False
        if track["id"] is None and track["hits"] >= self.confirmations:
            track["id"] = self._next_id
            self._next_id += 1
            became_confirmed = True
        return became_confirmed or track["id"] is not None

    def snapshot(self) -> list[dict]:
        objects = []
        for track in self._tracks:
            if track["id"] is None:
                continue
            points = list(track["voxels"].values())
            if not points:
                continue
            xyz = np.asarray(
                [[point["x"], point["y"], point["z"]] for point in points],
                dtype=np.float64,
            )
            minimum = np.percentile(xyz, 2.0, axis=0)
            maximum = np.percentile(xyz, 98.0, axis=0)
            chair_id = int(track["id"])
            objects.append({
                "id": chair_id,
                "name": f"chair {chair_id}",
                "label": "chair",
                "confidence": round(float(track["confidence"]), 3),
                "observations": int(track["hits"]),
                "age_s": round(max(0.0, time.monotonic() - track["last_seen"]), 2),
                "expires_in_s": round(max(
                    0.0,
                    self.lifespan_s - (time.monotonic() - track["last_seen"]),
                ), 2),
                "center": {
                    "x": round(float(track["center"][0]), 4),
                    "y": round(float(track["center"][1]), 4),
                    "z": round(float(track["center"][2]), 4),
                },
                "bounds": {
                    "min": {
                        "x": round(float(minimum[0]), 4),
                        "y": round(float(minimum[1]), 4),
                        "z": round(float(minimum[2]), 4),
                    },
                    "max": {
                        "x": round(float(maximum[0]), 4),
                        "y": round(float(maximum[1]), 4),
                        "z": round(float(maximum[2]), 4),
                    },
                },
                "points": points,
            })
        return objects
