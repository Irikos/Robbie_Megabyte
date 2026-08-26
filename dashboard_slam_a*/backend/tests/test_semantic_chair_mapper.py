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


def test_server_and_frontend_wire_semantic_chairs():
    server = (BACKEND / "server.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert "def _process_semantic_chairs(" in server
    assert "canonical_chair_label" in server
    assert '@app.get("/api/semantic/chairs")' in server
    assert "function renderSemanticChairs(message)" in frontend
    assert "semanticLabelSprite" in frontend
    assert "new THREE.EdgesGeometry" in frontend
