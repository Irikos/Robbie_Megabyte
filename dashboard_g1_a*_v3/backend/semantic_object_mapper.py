"""RealSense depth extraction and persistent 3D semantic object tracks.

The detector runs on the mirrored camera preview.  This module converts the
detected image box back to the raw, depth-aligned frame, reconstructs the
foreground in 3D and transforms it from the camera optical frame to Livox.
The server performs the final Livox -> map transform because it owns the live
robot pose and the map floor plane.
"""

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
    """Calibration with ``p_camera = R_camera_livox * p_livox + t``."""

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
        data_dir = calibration_dir / "data"
        transform_path = data_dir / "lidar_to_camera.yaml"
        text = transform_path.read_text(encoding="utf-8")
        translation_match = re.search(
            r"^translation_m:\s*(\[[^\n]+\])", text, re.MULTILINE
        )
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
        rotation = np.asarray(
            [ast.literal_eval(row) for row in rows], dtype=np.float64
        )
        if rotation.shape != (3, 3):
            raise ValueError("rotation_matrix trebuie să fie 3x3")

        intrinsics_path = data_dir / "camera_intrinsics.json"
        if intrinsics_path.is_file():
            camera = json.loads(intrinsics_path.read_text(encoding="utf-8"))
        else:
            metadata_paths = sorted(data_dir.glob("pose_*/metadata.json"))
            if not metadata_paths:
                raise ValueError("Lipsesc intrinsecii RealSense calibrate")
            camera = json.loads(
                metadata_paths[0].read_text(encoding="utf-8")
            )["camera"]
        if not camera.get("depth_aligned_to_color", False):
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
        return (points - self.translation_camera_livox) @ self.rotation_camera_livox


def canonical_obstacle_label(label: str) -> Optional[str]:
    """Normalize labels which represent the same physical chair geometry."""
    return "chair" if str(label).strip().lower() in {"chair", "toilet"} else None


def deduplicate_object_detections(
    detections: Iterable[dict],
    minimum_confidence: float = 0.35,
    iou_threshold: float = 0.35,
) -> list[dict]:
    """Class-independent NMS so overlapping chair/toilet boxes become one."""
    candidates = [
        detection for detection in detections
        if canonical_obstacle_label(detection.get("label", ""))
        and float(detection.get("confidence", 0.0)) >= minimum_confidence
    ]
    candidates.sort(
        key=lambda detection: float(detection.get("confidence", 0.0)),
        reverse=True,
    )
    kept = []
    for candidate in candidates:
        x1, y1 = float(candidate.get("x1", 0)), float(candidate.get("y1", 0))
        x2, y2 = float(candidate.get("x2", 0)), float(candidate.get("y2", 0))
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        overlaps = False
        for previous in kept:
            px1, py1 = float(previous["x1"]), float(previous["y1"])
            px2, py2 = float(previous["x2"]), float(previous["y2"])
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
    """Reconstruct a detected foreground and return RGB points in Livox."""
    if depth_img is None or color_img is None or depth_img.ndim != 2:
        return []
    height, width = depth_img.shape
    if color_img.shape[:2] != (height, width):
        return []

    # YOLO sees the horizontally mirrored preview; depth is not mirrored.
    flipped_x1 = int(detection.get("x1", 0))
    flipped_x2 = int(detection.get("x2", 0))
    y1 = max(0, min(height - 1, int(detection.get("y1", 0))))
    y2 = max(0, min(height, int(detection.get("y2", 0))))
    raw_x1 = max(0, min(width - 1, width - flipped_x2))
    raw_x2 = max(0, min(width, width - flipped_x1))
    if raw_x2 - raw_x1 < 8 or y2 - y1 < 8:
        return []

    margin_x = max(1, int((raw_x2 - raw_x1) * 0.04))
    margin_y = max(1, int((y2 - y1) * 0.03))
    raw_x1, raw_x2 = raw_x1 + margin_x, raw_x2 - margin_x
    y1, y2 = y1 + margin_y, y2 - margin_y
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
    foreground_depth = float(np.percentile(depth_m[valid], 20.0))
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
    fx, fy = calibration.fx * scale_x, calibration.fy * scale_y
    cx, cy = calibration.cx * scale_x, calibration.cy * scale_y
    camera_points = np.column_stack((
        (u - cx) * z / fx,
        (v - cy) * z / fy,
        z,
    ))
    livox_points = calibration.camera_to_livox(camera_points)
    colors = color_img[v.astype(np.int32), u.astype(np.int32)]
    output = []
    for point, bgr in zip(livox_points, colors):
        if np.isfinite(point).all():
            output.append({
                "x": float(point[0]), "y": float(point[1]),
                "z": float(point[2]), "r": int(bgr[2]),
                "g": int(bgr[1]), "b": int(bgr[0]),
            })
    return output


class SemanticObjectTracker:
    """Semantic 3D tracks confirmed by camera and supported by live LiDAR.

    The RGB-D cloud is the only source which assigns a semantic label.  A
    recent Livox frame never creates a furniture hypothesis on its own, but it
    supports an existing one and can prove that an observed volume is empty.
    This is deliberately the same evidence model used by ``dashboard_g1_test``:
    the map is not polluted with a chair after it has been moved away.
    """

    def __init__(
        self,
        confirmations: int = 3,
        merge_distance_m: float = 0.70,
        voxel_size_m: float = 0.025,
        lifespan_s: float = 10.0,
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
                track, best_distance = candidate, distance
        if track is None:
            track = {
                "id": None, "hits": 0, "center": center.tolist(),
                "last_seen": now, "confidence": 0.0, "voxels": {},
                "semantic_confidence": 0.0, "lidar_confidence": 0.0,
                "lidar_supported": False, "last_lidar_seen": 0.0,
                "visible_misses": 0,
            }
            self._tracks.append(track)

        track["hits"] += 1
        track["last_seen"] = now
        track["confidence"] = max(float(confidence), track["confidence"])
        track["semantic_confidence"] = min(
            100.0, float(track.get("semantic_confidence", 0.0)) + 8.0
        )
        previous = np.asarray(track["center"], dtype=np.float64)
        track["center"] = (previous * 0.75 + center * 0.25).tolist()
        for point in points:
            key = tuple(
                round(float(point[axis]) / self.voxel_size_m)
                for axis in ("x", "y", "z")
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

    def _lidar_evidence(self, track: dict, lidar_points: list[dict], sensor_pose: Optional[dict]) -> tuple[int, bool, bool]:
        """Count returns inside a semantic volume and detect a clear ray.

        ``cleared`` is intentionally conservative: an object is removed only
        when it is in front of the robot, no return falls in its volume, and
        several LiDAR returns are measured behind it along the same ray.
        """
        if not sensor_pose:
            return 0, False, False
        center_x, center_y, center_z = [float(value) for value in track["center"]]
        pose_x = float(sensor_pose.get("x", 0.0))
        pose_y = float(sensor_pose.get("y", 0.0))
        pose_yaw = float(sensor_pose.get("yaw", 0.0))
        dx, dy = center_x - pose_x, center_y - pose_y
        cosine, sine = math.cos(pose_yaw), math.sin(pose_yaw)
        forward = cosine * dx + sine * dy
        left = -sine * dx + cosine * dy
        visible = 0.25 <= forward <= 4.2 and abs(math.atan2(left, forward)) <= math.radians(36.0)
        if not lidar_points:
            return 0, visible, False

        points = list(track.get("voxels", {}).values())
        z_values = [float(point["z"]) for point in points] or [center_z]
        min_z, max_z = min(z_values) - 0.15, max(z_values) + 0.20
        radius = max(0.28, min(0.60, self.merge_distance_m))
        target_range = math.hypot(dx, dy)
        target_angle = math.atan2(dy, dx)
        angular_gate = max(math.radians(2.0), math.atan2(radius * 0.55, max(0.2, target_range)))
        support = 0
        returns_behind = 0
        for point in lidar_points:
            x, y = float(point.get("x", 0.0)), float(point.get("y", 0.0))
            z = float(point.get("z", center_z))
            if math.hypot(x - center_x, y - center_y) <= radius and min_z <= z <= max_z:
                support += 1
            point_dx, point_dy = x - pose_x, y - pose_y
            point_range = math.hypot(point_dx, point_dy)
            angle_error = abs((math.atan2(point_dy, point_dx) - target_angle + math.pi) % (2 * math.pi) - math.pi)
            if point_range >= target_range + 0.25 and angle_error <= angular_gate:
                returns_behind += 1
        return support, visible, visible and support < 4 and returns_behind >= 3

    def update_frame(
        self,
        observations: Iterable[dict],
        lidar_points: Optional[list[dict]],
        sensor_pose: Optional[dict],
        observed_at: Optional[float] = None,
    ) -> bool:
        """Fuse one YOLO/RGB-D frame with one recent raw LiDAR frame."""
        now = float(time.monotonic() if observed_at is None else observed_at)
        matched: set[int] = set()
        changed = False
        for observation in observations:
            points = list(observation.get("points", []))
            if len(points) < 20:
                continue
            center = np.median(
                np.asarray([[point["x"], point["y"], point["z"]] for point in points], dtype=np.float64),
                axis=0,
            )
            self.observe(points, float(observation.get("confidence", 0.0)), now)
            best_index = None
            best_distance = math.inf
            for index, track in enumerate(self._tracks):
                distance = math.hypot(float(center[0]) - track["center"][0], float(center[1]) - track["center"][1])
                if distance <= self.merge_distance_m and distance < best_distance:
                    best_index, best_distance = index, distance
            if best_index is not None:
                matched.add(best_index)

        for index in range(len(self._tracks) - 1, -1, -1):
            track = self._tracks[index]
            support, visible, cleared = self._lidar_evidence(track, lidar_points or [], sensor_pose)
            if support >= 4:
                track["lidar_supported"] = True
                track["last_lidar_seen"] = now
                track["lidar_confidence"] = min(100.0, float(track.get("lidar_confidence", 0.0)) + 6.0)
            elif index in matched:
                track["lidar_supported"] = False
                track["lidar_confidence"] = max(0.0, float(track.get("lidar_confidence", 0.0)) - 1.0)
            elif cleared:
                track["visible_misses"] = int(track.get("visible_misses", 0)) + 1
                track["lidar_supported"] = False
                track["lidar_confidence"] = max(0.0, float(track.get("lidar_confidence", 0.0)) - 10.0)
                # A confirmed object disappears only after two independent
                # ray-cleared frames; one sparse LiDAR frame is not enough.
                if track["id"] is not None and track["visible_misses"] >= 2:
                    self._tracks.pop(index)
                    changed = True
                    continue
            if index in matched:
                track["visible_misses"] = 0
            changed = changed or track.get("id") is not None
        return changed

    def snapshot(self) -> list[dict]:
        now = time.monotonic()
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
            object_id = int(track["id"])
            age = max(0.0, now - track["last_seen"])
            objects.append({
                "id": object_id,
                "name": f"chair {object_id}",
                "label": "chair",
                "confidence": round(float(track["confidence"]), 3),
                "semantic_confidence": round(float(track.get("semantic_confidence", 0.0)), 1),
                "lidar_confidence": round(float(track.get("lidar_confidence", 0.0)), 1),
                "lidar_supported": bool(track.get("lidar_supported", False)),
                "visible_misses": int(track.get("visible_misses", 0)),
                "observations": int(track["hits"]),
                "age_s": round(age, 2),
                "expires_in_s": round(max(0.0, self.lifespan_s - age), 2),
                "center": {
                    "x": round(float(track["center"][0]), 4),
                    "y": round(float(track["center"][1]), 4),
                    "z": round(float(track["center"][2]), 4),
                },
                "bounds": {
                    "min": {axis: round(float(minimum[index]), 4)
                            for index, axis in enumerate(("x", "y", "z"))},
                    "max": {axis: round(float(maximum[index]), 4)
                            for index, axis in enumerate(("x", "y", "z"))},
                },
                "points": points,
            })
        return objects
