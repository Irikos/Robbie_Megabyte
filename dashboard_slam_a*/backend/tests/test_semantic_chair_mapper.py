from pathlib import Path
import sys

import numpy as np
import pytest


BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from semantic_chair_mapper import (
    LidarCameraCalibration,
    SemanticChairTracker,
    canonical_chair_label,
    deduplicate_chair_detections,
    extract_livox_points,
)


def test_repository_calibration_inverts_camera_livox_transform():
    calibration = LidarCameraCalibration.load(ROOT / "lidar_camera_calibration")
    livox = np.asarray([
        [0.8, -0.2, 0.1],
        [1.4, 0.3, -0.4],
    ])
    camera = (
        livox @ calibration.rotation_camera_livox.T
        + calibration.translation_camera_livox
    )

    reconstructed = calibration.camera_to_livox(camera)

    assert reconstructed == pytest.approx(livox, abs=1e-7)
    assert calibration.width == 640
    assert calibration.height == 480
    assert calibration.depth_scale_m == pytest.approx(0.001, rel=1e-5)


def test_toilet_and_chair_are_both_canonical_chairs():
    assert canonical_chair_label("chair") == "chair"
    assert canonical_chair_label("toilet") == "chair"
    assert canonical_chair_label("person") is None


def test_overlapping_chair_and_toilet_boxes_are_one_detection():
    detections = [
        {"label": "chair", "confidence": 0.72, "x1": 10, "y1": 12, "x2": 110, "y2": 150},
        {"label": "toilet", "confidence": 0.86, "x1": 14, "y1": 15, "x2": 108, "y2": 147},
        {"label": "chair", "confidence": 0.68, "x1": 210, "y1": 20, "x2": 300, "y2": 155},
        {"label": "person", "confidence": 0.99, "x1": 0, "y1": 0, "x2": 50, "y2": 50},
    ]

    kept = deduplicate_chair_detections(detections)

    assert len(kept) == 2
    assert kept[0]["label"] == "toilet"
    assert kept[1]["x1"] == 210


def test_flipped_yolo_box_is_unflipped_before_depth_extraction():
    calibration = LidarCameraCalibration(
        rotation_camera_livox=np.eye(3),
        translation_camera_livox=np.zeros(3),
        fx=100.0,
        fy=100.0,
        cx=50.0,
        cy=30.0,
        width=100,
        height=60,
        depth_scale_m=0.001,
    )
    depth = np.full((60, 100), 1000, dtype=np.uint16)
    color = np.zeros((60, 100, 3), dtype=np.uint8)
    color[:, :, 2] = 255

    points = extract_livox_points(
        depth,
        color,
        {"x1": 20, "x2": 40, "y1": 10, "y2": 50},
        calibration,
        sample_step=2,
    )

    assert len(points) >= 20
    # Flipped [20, 40] maps to raw image [60, 80], hence camera X > 0.
    assert np.median([point["x"] for point in points]) > 0.10
    assert all(point["r"] == 255 for point in points)


def _chair_points(center_x, center_y):
    return [
        {
            "x": center_x + (index % 5) * 0.025,
            "y": center_y + (index // 5) * 0.025,
            "z": 0.2 + (index % 3) * 0.04,
            "r": 120,
            "g": 80,
            "b": 40,
        }
        for index in range(30)
    ]


def test_tracker_confirms_three_frames_deduplicates_and_numbers_stably():
    tracker = SemanticChairTracker(confirmations=3, merge_distance_m=0.70)
    for frame in range(3):
        tracker.observe(_chair_points(1.0 + frame * 0.01, 2.0), 0.82, frame * 0.2)

    first = tracker.snapshot()
    assert len(first) == 1
    assert first[0]["name"] == "chair 1"

    tracker.observe(_chair_points(1.08, 2.04), 0.90, 1.0)
    assert len(tracker.snapshot()) == 1

    for frame in range(3):
        tracker.observe(_chair_points(3.0, -1.0), 0.75, 2.0 + frame * 0.2)
    objects = tracker.snapshot()
    assert [item["name"] for item in objects] == ["chair 1", "chair 2"]


def _observation(center_x, center_y, confidence=0.82):
    return {"points": _chair_points(center_x, center_y), "confidence": confidence}


def _clearing_returns(x=2.0):
    return [
        {"x": x, "y": offset, "z": 0.25}
        for offset in (-0.08, -0.04, 0.0, 0.04, 0.08)
    ]


def test_tracker_uses_dictionary_spatial_index_and_caps_aging():
    tracker = SemanticChairTracker(
        confirmations=3,
        merge_distance_m=0.45,
        aging_cap=40.0,
    )
    for frame in range(20):
        tracker.update_frame([_observation(1.0, 0.0)], [], {"x": 0, "y": 0, "yaw": 0}, frame * 0.25)

    objects = tracker.snapshot()
    assert isinstance(tracker._tracks, dict)
    assert isinstance(tracker._spatial_index, dict)
    assert len(objects) == 1
    assert objects[0]["aging_value"] == 40.0
    assert objects[0]["aging_cap"] == 40.0


def test_lidar_support_preserves_object_and_visible_miss_removes_it():
    tracker = SemanticChairTracker(confirmations=3, merge_distance_m=0.45)
    pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
    for frame in range(3):
        tracker.update_frame([_observation(1.0, 0.0)], [], pose, frame * 0.25)
    initial = tracker.snapshot()[0]["aging_value"]

    supporting_lidar = [
        {"x": 1.0 + 0.02 * (index % 3), "y": -0.04 + 0.04 * (index // 3), "z": 0.24}
        for index in range(9)
    ]
    away_pose = {"x": 0.0, "y": 0.0, "yaw": np.pi}
    tracker.update_frame([], supporting_lidar, away_pose, 1.0)
    supported = tracker.snapshot()[0]
    assert supported["aging_value"] > initial
    assert supported["lidar_supported"] is True

    # A missing observation at a visible coordinate decreases aging even when
    # the LiDAR produces no return behind the old chair.
    for frame in range(20):
        tracker.update_frame([], [], pose, 2.0 + frame * 0.25)
        if not tracker.snapshot():
            break
    assert tracker.snapshot() == []


def test_unobservable_object_is_not_penalized_and_moved_chair_gets_new_id():
    tracker = SemanticChairTracker(confirmations=3, merge_distance_m=0.35)
    forward_pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
    for frame in range(3):
        tracker.update_frame([_observation(1.0, 0.0)], [], forward_pose, frame * 0.25)
    original = tracker.snapshot()[0]

    away_pose = {"x": 0.0, "y": 0.0, "yaw": np.pi}
    for frame in range(10):
        tracker.update_frame([], [], away_pose, 2.0 + frame * 0.25)
    assert tracker.snapshot()[0]["aging_value"] == original["aging_value"]

    # The new coordinate is outside the association gate. It becomes chair 2;
    # the visible old coordinate loses aging even without LiDAR clearing rays.
    for frame in range(3):
        tracker.update_frame(
            [_observation(2.0, 0.0)], [], forward_pose,
            5.0 + frame * 0.25,
        )
    objects = tracker.snapshot()
    assert [obj["id"] for obj in objects] == [2]
    assert objects[0]["center"]["x"] == pytest.approx(2.05, abs=0.12)


def test_server_and_frontend_wire_semantic_chairs():
    server = (BACKEND / "server.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert "def _process_semantic_chairs(" in server
    assert "deduplicate_chair_detections" in server
    assert "semantic_chair_aging_loop" in server
    assert "aging_cap=100.0" in server
    assert '"aging_cap": semantic_chair_tracker.aging_cap' in server
    assert "_semantic_lidar_map_snapshot" in server
    assert '@app.get("/api/semantic/chairs")' in server
    assert "function renderSemanticChairs(message)" in frontend
    assert "semanticLabelSprite" in frontend
    assert "AGING ${value.toFixed(0)}/${cap.toFixed(0)}" in frontend
    assert "new THREE.EdgesGeometry" in frontend
