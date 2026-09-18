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
    """Confidence map backed by an ID dictionary and a spatial hash.

    YOLO supplies semantics. LiDAR only supports existing hypotheses or proves
    that a previously occupied, currently observable volume has been cleared.
    Confirmed objects remain anchored; a chair moved beyond the association
    gate creates a new hypothesis while the old coordinate loses evidence.
    """

    def __init__(
        self,
        confirmations: int = 3,
        merge_distance_m: float = 0.45,
        voxel_size_m: float = 0.025,
        lifespan_s: float = 10.0,
        max_voxels: int = 10000,
        aging_cap: float = 100.0,
        growth_per_observation: float = 6.0,
        visible_miss_decay: float = 9.0,
    ):
        self.confirmations = max(1, int(confirmations))
        self.merge_distance_m = max(0.15, float(merge_distance_m))
        self.voxel_size_m = float(voxel_size_m)
        self.lifespan_s = max(1.0, float(lifespan_s))  # compatibility metadata
        self.max_voxels = max(100, int(max_voxels))
        self.aging_cap = max(10.0, float(aging_cap))
        self.growth_per_observation = max(0.1, float(growth_per_observation))
        self.visible_miss_decay = max(
            self.growth_per_observation + 0.1, float(visible_miss_decay)
        )
        self.confirmation_score = self.confirmations * self.growth_per_observation
        self.spatial_cell_m = self.merge_distance_m
        self._tracks: dict[int, dict] = {}
        self._spatial_index: dict[tuple[int, int], set[int]] = {}
        self._next_track_key = 1
        self._next_id = 1

    def reset(self) -> None:
        self._tracks = {}
        self._spatial_index = {}
        self._next_track_key = 1
        self._next_id = 1

    def _cell(self, x: float, y: float) -> tuple[int, int]:
        return (
            math.floor(float(x) / self.spatial_cell_m),
            math.floor(float(y) / self.spatial_cell_m),
        )

    def _index(self, key: int, track: dict) -> None:
        cell = self._cell(track["anchor"][0], track["anchor"][1])
        track["spatial_cell"] = cell
        self._spatial_index.setdefault(cell, set()).add(key)

    def _reindex(self, key: int, track: dict) -> None:
        previous = track.get("spatial_cell")
        current = self._cell(track["anchor"][0], track["anchor"][1])
        if previous == current:
            return
        members = self._spatial_index.get(previous)
        if members:
            members.discard(key)
            if not members:
                self._spatial_index.pop(previous, None)
        track["spatial_cell"] = current
        self._spatial_index.setdefault(current, set()).add(key)

    def _remove(self, key: int) -> None:
        track = self._tracks.pop(key, None)
        if not track:
            return
        cell = track.get("spatial_cell")
        members = self._spatial_index.get(cell)
        if members:
            members.discard(key)
            if not members:
                self._spatial_index.pop(cell, None)

    def _nearby(self, center: np.ndarray) -> list[tuple[int, dict]]:
        cell_x, cell_y = self._cell(center[0], center[1])
        keys: set[int] = set()
        for offset_x in (-1, 0, 1):
            for offset_y in (-1, 0, 1):
                keys.update(self._spatial_index.get((cell_x + offset_x, cell_y + offset_y), ()))
        return [(key, self._tracks[key]) for key in keys if key in self._tracks]

    @staticmethod
    def _valid_points(points: Iterable[dict]) -> tuple[list[dict], np.ndarray]:
        points = list(points)
        if len(points) < 20:
            return [], np.empty((0, 3), dtype=np.float64)
        xyz = np.asarray(
            [[point["x"], point["y"], point["z"]] for point in points],
            dtype=np.float64,
        )
        finite = np.isfinite(xyz).all(axis=1)
        return [point for point, keep in zip(points, finite) if keep], xyz[finite]

    def _lidar_evidence(
        self, track: dict, lidar_points: list[dict], sensor_pose: Optional[dict]
    ) -> tuple[int, bool, bool]:
        """Return support count, camera visibility and ray-clearing evidence."""
        if not sensor_pose:
            return 0, False, False
        pose_x = float(sensor_pose.get("x", 0.0))
        pose_y = float(sensor_pose.get("y", 0.0))
        pose_yaw = float(sensor_pose.get("yaw", 0.0))
        center_x, center_y, _ = track["anchor"]
        dx, dy = center_x - pose_x, center_y - pose_y
        cosine, sine = math.cos(pose_yaw), math.sin(pose_yaw)
        forward = cosine * dx + sine * dy
        left = -sine * dx + cosine * dy
        visible = 0.25 <= forward <= 4.2 and abs(math.atan2(left, forward)) <= math.radians(36)
        if not lidar_points:
            return 0, visible, False

        points = list(track["voxels"].values())
        z_values = [float(point["z"]) for point in points] or [track["anchor"][2]]
        min_z, max_z = min(z_values) - 0.15, max(z_values) + 0.20
        radius = max(0.28, min(0.60, self.merge_distance_m))
        support = 0
        target_range = math.hypot(dx, dy)
        target_angle = math.atan2(dy, dx)
        angular_gate = max(math.radians(2.0), math.atan2(radius * 0.55, max(0.2, target_range)))
        returns_behind = 0
        for point in lidar_points:
            x, y = float(point.get("x", 0.0)), float(point.get("y", 0.0))
            z = float(point.get("z", track["anchor"][2]))
            if math.hypot(x - center_x, y - center_y) <= radius and min_z <= z <= max_z:
                support += 1
            point_dx, point_dy = x - pose_x, y - pose_y
            point_range = math.hypot(point_dx, point_dy)
            angle_error = abs((math.atan2(point_dy, point_dx) - target_angle + math.pi) % (2 * math.pi) - math.pi)
            if point_range >= target_range + 0.25 and angle_error <= angular_gate:
                returns_behind += 1
        cleared = visible and support < 4 and returns_behind >= 3
        return support, visible, cleared

    def _observe_points(
        self, points: Iterable[dict], confidence: float, now: float,
        lidar_points: Optional[list[dict]] = None, sensor_pose: Optional[dict] = None,
    ) -> tuple[Optional[int], bool]:
        points, xyz = self._valid_points(points)
        if len(points) < 20:
            return None, False
        center = np.median(xyz, axis=0)
        best_key, best_track, best_distance = None, None, math.inf
        for key, candidate in self._nearby(center):
            distance = math.hypot(center[0] - candidate["anchor"][0], center[1] - candidate["anchor"][1])
            if distance <= self.merge_distance_m and distance < best_distance:
                best_key, best_track, best_distance = key, candidate, distance
        if best_track is None:
            best_key = self._next_track_key
            self._next_track_key += 1
            best_track = {
                "id": None, "hits": 0, "anchor": center.tolist(), "center": center.tolist(),
                "last_seen": now, "last_lidar_seen": 0.0, "confidence": 0.0,
                "aging": 0.0, "semantic_confidence": 0.0, "lidar_confidence": 0.0,
                "lidar_supported": False, "visible_misses": 0, "voxels": {},
            }
            self._tracks[best_key] = best_track
            self._index(best_key, best_track)

        support, _, _ = self._lidar_evidence(best_track, lidar_points or [], sensor_pose)
        best_track["hits"] += 1
        best_track["last_seen"] = now
        best_track["confidence"] = max(float(confidence), best_track["confidence"])
        best_track["semantic_confidence"] = min(100.0, best_track["semantic_confidence"] + 8.0)
        best_track["aging"] = min(
            self.aging_cap,
            best_track["aging"] + self.growth_per_observation + (2.0 if support >= 4 else 0.0),
        )
        best_track["visible_misses"] = 0
        best_track["lidar_supported"] = support >= 4
        if support >= 4:
            best_track["last_lidar_seen"] = now
            best_track["lidar_confidence"] = min(100.0, best_track["lidar_confidence"] + 6.0)
        else:
            best_track["lidar_confidence"] = max(0.0, best_track["lidar_confidence"] - 1.0)

        # Confirmed furniture remains spatially anchored. Candidate centers may
        # settle within the gate before receiving their public chair number.
        if best_track["id"] is None:
            previous = np.asarray(best_track["center"], dtype=np.float64)
            best_track["center"] = (previous * 0.65 + center * 0.35).tolist()
            best_track["anchor"] = list(best_track["center"])
            self._reindex(best_key, best_track)
        for point in points:
            if math.hypot(float(point["x"]) - best_track["anchor"][0], float(point["y"]) - best_track["anchor"][1]) > self.merge_distance_m:
                continue
            voxel = (
                round(float(point["x"]) / self.voxel_size_m),
                round(float(point["y"]) / self.voxel_size_m),
                round(float(point["z"]) / self.voxel_size_m),
            )
            if voxel not in best_track["voxels"] and len(best_track["voxels"]) < self.max_voxels:
                best_track["voxels"][voxel] = {
                    "x": round(float(point["x"]), 4), "y": round(float(point["y"]), 4),
                    "z": round(float(point["z"]), 4), "r": int(point.get("r", 180)),
                    "g": int(point.get("g", 180)), "b": int(point.get("b", 180)),
                }
        became_confirmed = False
        if (best_track["id"] is None and best_track["hits"] >= self.confirmations
                and best_track["aging"] >= self.confirmation_score):
            best_track["id"] = self._next_id
            self._next_id += 1
            became_confirmed = True
        return best_key, became_confirmed or best_track["id"] is not None

    def observe(
        self, points: Iterable[dict], confidence: float,
        observed_at: Optional[float] = None,
    ) -> bool:
        """Compatibility helper for one positive camera observation."""
        _, changed = self._observe_points(
            points, confidence,
            float(time.monotonic() if observed_at is None else observed_at),
        )
        return changed

    def update_frame(
        self, observations: Iterable[dict], lidar_points: Optional[list[dict]],
        sensor_pose: Optional[dict], observed_at: Optional[float] = None,
    ) -> bool:
        """Fuse one camera frame and one recent raw LiDAR scan."""
        now = float(time.monotonic() if observed_at is None else observed_at)
        matched: set[int] = set()
        changed = False
        for observation in observations:
            key, visible = self._observe_points(
                observation.get("points", []), float(observation.get("confidence", 0.0)),
                now, lidar_points or [], sensor_pose,
            )
            if key is not None:
                matched.add(key)
            changed = changed or visible

        for key, track in list(self._tracks.items()):
            if key in matched:
                continue
            support, visible, _ = self._lidar_evidence(track, lidar_points or [], sensor_pose)
            before = float(track["aging"])
            if visible:
                track["aging"] = max(0.0, before - self.visible_miss_decay)
                track["visible_misses"] += 1
                track["lidar_supported"] = False
                track["lidar_confidence"] = max(0.0, track["lidar_confidence"] - 10.0)
            elif support >= 4:
                track["aging"] = min(self.aging_cap, before + 1.0)
                track["last_lidar_seen"] = now
                track["lidar_supported"] = True
                track["lidar_confidence"] = min(100.0, track["lidar_confidence"] + 3.0)
            # The requested behavior is intentionally simple: if the saved
            # coordinate is in the forward camera view but no chair/toilet
            # observation matched it in this frame, its aging decreases. This
            # deliberately takes precedence over LiDAR support so that floor or
            # background returns cannot keep a removed chair alive. Outside the
            # view remains unknown and may still receive genuine LiDAR support.
            if track["id"] is None and now - track["last_seen"] > 2.0:
                track["aging"] = 0.0
            if track["aging"] <= 0.0:
                self._remove(key)
                changed = True
            elif track["aging"] != before:
                changed = changed or track["id"] is not None
        return changed

    def expire(self, observed_at: Optional[float] = None) -> bool:
        """Only stale, unconfirmed candidates expire without visibility evidence."""
        now = float(time.monotonic() if observed_at is None else observed_at)
        removed = False
        for key, track in list(self._tracks.items()):
            if track["id"] is None and now - track["last_seen"] > 2.0:
                self._remove(key)
                removed = True
        return removed

    def snapshot(self) -> list[dict]:
        objects = []
        now = time.monotonic()
        for track in sorted(self._tracks.values(), key=lambda item: item["id"] or math.inf):
            if track["id"] is None or track["aging"] <= 0.0:
                continue
            points = list(track["voxels"].values())
            if not points:
                continue
            xyz = np.asarray([[p["x"], p["y"], p["z"]] for p in points], dtype=np.float64)
            minimum, maximum = np.percentile(xyz, 2.0, axis=0), np.percentile(xyz, 98.0, axis=0)
            chair_id = int(track["id"])
            objects.append({
                "id": chair_id, "name": f"chair {chair_id}", "label": "chair",
                "confidence": round(float(track["confidence"]), 3),
                "semantic_confidence": round(float(track["semantic_confidence"]), 1),
                "lidar_confidence": round(float(track["lidar_confidence"]), 1),
                "lidar_supported": bool(track["lidar_supported"]),
                "aging_value": round(float(track["aging"]), 1),
                "aging_cap": round(float(self.aging_cap), 1),
                "observations": int(track["hits"]), "visible_misses": int(track["visible_misses"]),
                "age_s": round(max(0.0, now - track["last_seen"]), 2),
                "center": {"x": round(float(track["anchor"][0]), 4),
                           "y": round(float(track["anchor"][1]), 4),
                           "z": round(float(track["anchor"][2]), 4)},
                "bounds": {
                    "min": {"x": round(float(minimum[0]), 4), "y": round(float(minimum[1]), 4), "z": round(float(minimum[2]), 4)},
                    "max": {"x": round(float(maximum[0]), 4), "y": round(float(maximum[1]), 4), "z": round(float(maximum[2]), 4)},
                },
                "points": points,
            })
        return objects
