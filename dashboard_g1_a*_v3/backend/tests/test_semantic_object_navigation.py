from pathlib import Path

import numpy as np
import pytest

from autonomous_navigation import NativeWaypointNavigator, PCDGridPlanner
from robot_client import ObstacleGuard
from semantic_object_mapper import (
    LidarCameraCalibration,
    SemanticObjectTracker,
    canonical_obstacle_label,
    deduplicate_object_detections,
    extract_livox_points,
)


ROOT = Path(__file__).resolve().parents[2]


def _object_points(center_x=1.0, center_y=0.0):
    return [
        {
            "x": center_x + (index % 6) * 0.025,
            "y": center_y + (index // 6) * 0.025,
            "z": 0.2 + (index % 4) * 0.05,
            "r": 120, "g": 80, "b": 40,
        }
        for index in range(36)
    ]


def test_calibration_round_trip_and_intrinsics_are_local_to_v3():
    calibration = LidarCameraCalibration.load(ROOT / "lidar_camera_calibration")
    livox = np.asarray([[0.8, -0.2, 0.1], [1.4, 0.3, -0.4]])
    camera = (
        livox @ calibration.rotation_camera_livox.T
        + calibration.translation_camera_livox
    )
    assert calibration.camera_to_livox(camera) == pytest.approx(livox, abs=1e-7)
    assert (calibration.width, calibration.height) == (640, 480)


def test_chair_boxes_are_deduplicated_and_mirrored_depth_is_unflipped():
    detections = [
        {"label":"chair", "confidence":0.72, "x1":10, "y1":10, "x2":110, "y2":150},
        {"label":"toilet", "confidence":0.86, "x1":14, "y1":14, "x2":108, "y2":148},
        {"label":"person", "confidence":0.99, "x1":0, "y1":0, "x2":50, "y2":50},
    ]
    assert canonical_obstacle_label("toilet") == "chair"
    assert len(deduplicate_object_detections(detections)) == 1

    calibration = LidarCameraCalibration(
        np.eye(3), np.zeros(3), 100.0, 100.0, 50.0, 30.0,
        100, 60, 0.001,
    )
    depth = np.full((60, 100), 1000, dtype=np.uint16)
    color = np.zeros((60, 100, 3), dtype=np.uint8)
    color[:, :, 2] = 255
    points = extract_livox_points(
        depth, color,
        {"x1":20, "x2":40, "y1":10, "y2":50},
        calibration, sample_step=2,
    )
    assert len(points) >= 20
    assert np.median([point["x"] for point in points]) > 0.10


def test_confirmed_3d_object_becomes_a_planner_obstacle():
    tracker = SemanticObjectTracker(confirmations=3, lifespan_s=10.0)
    for frame in range(3):
        tracker.observe(_object_points(1.0 + frame * 0.01), 0.84, frame * 0.2)
    objects = tracker.snapshot()
    assert [item["name"] for item in objects] == ["chair 1"]

    guard = ObstacleGuard()
    guard.update_semantic_objects(objects)
    shapes = guard.semantic_obstacle_shapes()
    assert len(shapes) == 1
    assert len(shapes[0]["points"]) >= 4

    async def no_op(*_args, **_kwargs):
        return {"success": True}

    navigator = NativeWaypointNavigator(
        pose_provider=lambda: {"x":0.0, "y":0.0, "yaw":0.0},
        localization_ok=lambda: True,
        obstacle_guard=guard,
        send_waypoint=no_op,
        pause_navigation=no_op,
        resume_navigation=no_op,
        event_callback=no_op,
    )
    navigator.planner = PCDGridPlanner(
        resolution=0.10, robot_radius=0.20, comfort_radius=0.45
    )
    navigator._sync_lidar_costmap(observed_at=5.0)

    semantic_cells = {
        cell for cell, source in navigator.planner.dynamic_sources.items()
        if source.startswith("semantic")
    }
    assert semantic_cells
    assert navigator.status["semantic_obstacles"][0]["label"] == "chair"


def test_live_lidar_support_is_fused_without_creating_an_unlabeled_obstacle():
    tracker = SemanticObjectTracker(confirmations=2, lifespan_s=10.0)
    points = _object_points(1.0, 0.0)
    lidar = [
        {"x": 1.0 + (index % 8) * 0.02, "y": (index // 8) * 0.02,
         "z": 0.20 + (index % 3) * 0.04}
        for index in range(48)
    ]
    pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
    for frame in range(2):
        tracker.update_frame(
            [{"points": points, "confidence": 0.88}], lidar, pose, frame * 0.2
        )
    snapshot = tracker.snapshot()
    assert len(snapshot) == 1
    assert snapshot[0]["lidar_supported"] is True
    assert snapshot[0]["lidar_confidence"] > 0


def test_frontend_renders_semantic_geometry_and_hides_blob_under_object():
    frontend = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "function renderSemanticObjects(message)" in frontend
    assert "function mapZToVisual(x, y, z)" in frontend
    assert "positions.push(mapped.tx,mapZToVisual(x,y,z),mapped.tz)" in frontend
    assert "new THREE.EdgesGeometry" in frontend
    assert "pointInsideSemanticObject(point)" in frontend
    assert "lidar_supported" in frontend
    assert '"type": "semantic_objects"' in server
    assert "obstacle_guard.update_semantic_objects(objects)" in server
