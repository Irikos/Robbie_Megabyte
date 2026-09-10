import asyncio
import math
import struct
from pathlib import Path

import server
from server import (
    RosBridge,
    execution_waypoints,
    dispatch_navigation_waypoint,
    flatten_cloud_xy,
    fsm_id_from_result,
    navigation_target_payload,
    plan_xy_route,
    read_pcd,
    safe_name,
    write_pcd_atomic,
    yaw_from_quaternion,
)


def test_flatten_cloud_xy_keeps_only_configured_height_band():
    points = [
        (1.01, 2.01, 0.2),
        (1.02, 2.02, 0.8),  # aceeași celulă XY
        (3.0, 4.0, 1.3),   # prea sus
        (5.0, 6.0, -0.4),  # prea jos
    ]
    flattened = flatten_cloud_xy(points)
    assert len(flattened) == 1
    assert flattened[0][2] == 0.5


def test_fsm_id_from_result():
    assert fsm_id_from_result({"response": {"payload": {"data": 801}}}) == 801
    assert fsm_id_from_result({
        "response": {"payload": {"data": {"fsm_id": "500"}}}
    }) == 500
    assert fsm_id_from_result({"response": {"payload": {"data": None}}}) is None


def test_run_uses_internal_ai_controller(monkeypatch):
    calls = []

    async def fake_read_robot_fsm():
        return {"success": True, "fsm_id": 4}

    async def fake_command(api_id, parameters, **_kwargs):
        calls.append((api_id, parameters))
        return {"success": True}

    async def fake_set_and_confirm(requested, expected, **_kwargs):
        calls.append((7101, {"data": requested}))
        assert requested in expected
        return {"success": True, "fsm_id": requested}

    monkeypatch.setattr(server, "read_robot_fsm", fake_read_robot_fsm)
    monkeypatch.setattr(server, "command", fake_command)
    monkeypatch.setattr(server, "set_and_confirm_fsm", fake_set_and_confirm)
    result = asyncio.run(server.activate_run_mode())

    assert result == {"success": True, "fsm_id": 801, "control": "internal_ai"}
    assert calls == [
        (7111, {"data": 2}),
        (7101, {"data": 801}),
        (7107, {"data": 1}),
    ]


def test_run_falls_back_to_external_user_controller(monkeypatch):
    calls = []

    async def fake_read_robot_fsm():
        return {"success": True, "fsm_id": 4}

    async def fake_command(api_id, parameters, **_kwargs):
        calls.append((api_id, parameters))
        if api_id == 7111:
            return {"success": False, "error": "internal indisponibil"}
        return {"success": True}

    async def fake_set_and_confirm(requested, expected, **_kwargs):
        calls.append((7101, {"data": requested}))
        return {"success": True, "fsm_id": requested}

    monkeypatch.setattr(server, "read_robot_fsm", fake_read_robot_fsm)
    monkeypatch.setattr(server, "command", fake_command)
    monkeypatch.setattr(server, "set_and_confirm_fsm", fake_set_and_confirm)
    result = asyncio.run(server.activate_run_mode())

    assert result == {"success": True, "fsm_id": 500, "control": "external_user"}
    assert calls == [
        (7111, {"data": 2}),
        (7110, {"data": False}),
        (7101, {"data": 500}),
        (7107, {"data": 1}),
    ]


def test_safe_name():
    assert safe_name("harta_01-test") == "harta_01-test"
    try:
        safe_name("../harta")
    except ValueError:
        pass
    else:
        raise AssertionError("path traversal trebuie refuzat")


def test_mapping_session_is_created_with_2d_folder(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(server, "PARTIAL_MAPS", tmp_path)
    session = server.create_mapping_session()
    assert session.parent == tmp_path
    assert session.name.startswith("mapping_")
    assert (session / "maps_2d").is_dir()


def test_ascii_pcd_round_trip(tmp_path: Path):
    path = tmp_path / "map.pcd"
    expected = [(1.0, 2.0, 0.2), (-3.5, 4.1, -0.1)]
    write_pcd_atomic(path, expected)
    assert read_pcd(path) == expected
    assert not (tmp_path / "map.pcd.tmp").exists()


def test_binary_pcd(tmp_path: Path):
    path = tmp_path / "binary.pcd"
    header = (
        b"VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\n"
        b"TYPE F F F F\nCOUNT 1 1 1 1\nWIDTH 1\nHEIGHT 1\n"
        b"POINTS 1\nDATA binary\n"
    )
    path.write_bytes(header + struct.pack("<ffff", 1.25, -2.5, 0.75, 9.0))
    assert read_pcd(path) == [(1.25, -2.5, 0.75)]


def test_quaternion_yaw():
    assert abs(yaw_from_quaternion(0.0, 0.0, 1.0, 0.0) - 3.141592653589793) < 1e-9


def test_source_does_not_import_unitree_sdk():
    source = (Path(__file__).parents[1] / "server.py").read_text()
    assert "import unitree_sdk2py" not in source


def test_mapping_uses_stabilized_mid360_without_laserscan_pipeline():
    source = (Path(__file__).parents[1] / "server.py").read_text()
    assert '"/utlidar/cloud_livox_mid360"' in source
    assert '"/state_estimator/odom_pelvis"' in source
    assert '"ros2_mid360_odom"' in source
    assert '"/scan_2d"' not in source
    assert '"local_mid360"' not in source


def test_relative_pose_preserves_robot_rotation_in_session_frame():
    pose = {"x": 0.0, "y": 1.0, "yaw": 3.141592653589793}
    origin = {"x": 0.0, "y": 0.0, "yaw": 1.5707963267948966}
    relative = RosBridge._relative_pose(pose, origin)
    assert abs(relative["x"] - 1.0) < 1e-9
    assert abs(relative["y"]) < 1e-9
    assert abs(relative["yaw"] - 1.5707963267948966) < 1e-9


def test_native_path_is_not_embedded_in_local_pcd(tmp_path: Path):
    path = tmp_path / "map.pcd"
    write_pcd_atomic(path, [(0.0, 0.0, 0.0)])
    assert b".g1_v5_" not in path.read_bytes()


def test_astar_preview_avoids_inflated_obstacle():
    result = plan_xy_route([(0.0, 0.0, 0.5)], (-1.0, 0.0), (1.0, 0.0))
    assert result["distance"] > 2.0
    assert result["points"][0] == [-1.0, 0.0]
    assert result["points"][-1] == [1.0, 0.0]
    assert any(abs(point[1]) >= 0.2 for point in result["points"])


def test_execution_waypoints_preserve_goal_and_limit_spacing():
    route = [[0.0, 0.0], [0.2, 0.0], [0.4, 0.0], [1.2, 0.0], [1.2, 1.0]]
    waypoints = execution_waypoints(route, spacing=0.5)
    assert waypoints[0] == (0.0, 0.0)
    assert waypoints[-1] == (1.2, 1.0)
    assert all(
        math.hypot(second[0] - first[0], second[1] - first[1]) <= 0.500001
        for first, second in zip(waypoints, waypoints[1:])
    )


def test_navigation_waypoints_use_native_bypass_mode():
    payload = navigation_target_payload((1.25, -0.5), 0.0, 0.2)
    assert payload["data"]["targetPose"]["x"] == 1.25
    assert payload["data"]["targetPose"]["y"] == -0.5
    assert payload["data"]["mode"] == 0
    assert payload["data"]["speed"] == 0.2


def test_navigation_waypoint_reasserts_run_after_native_command(monkeypatch):
    calls = []

    async def fake_command(api_id, parameters, **kwargs):
        calls.append((api_id, parameters, kwargs.get("service", "slam")))
        return {"success": True, "response": {"api_id": api_id}}

    monkeypatch.setattr(server, "command", fake_command)
    result = asyncio.run(dispatch_navigation_waypoint((1.25, -0.5), 0.0, 0.2))

    assert result["success"]
    assert calls == [
        (1102, navigation_target_payload((1.25, -0.5), 0.0, 0.2), "slam"),
        (7107, {"data": 1}, "sport"),
    ]


def test_route_executor_dispatches_every_remaining_waypoint(monkeypatch):
    calls = []

    class FakeNode:
        lock = server.threading.RLock()
        navigation_cancel_requested = False
        navigation_paused = False
        navigation_status = {"state": "dispatching", "message": "", "waypoint": 1, "waypoints": 3}

    async def fake_wait(_node, _point, _tolerance, _index, _count):
        return True, ""

    async def fake_command(api_id, parameters, **_kwargs):
        calls.append((api_id, parameters))
        return {"success": True}

    monkeypatch.setattr(server, "wait_for_navigation_waypoint", fake_wait)
    monkeypatch.setattr(server, "command", fake_command)
    waypoints = [(0.0, 0.0), (0.8, 0.0), (1.6, 0.0), (2.0, 0.0)]
    asyncio.run(server.follow_planned_route(FakeNode(), waypoints, 0.5, 0.2))

    assert [api_id for api_id, _payload in calls] == [1102, 7107, 1102, 7107]
    navigation_payloads = [payload for api_id, payload in calls if api_id == 1102]
    assert [payload["data"]["targetPose"]["x"] for payload in navigation_payloads] == [1.6, 2.0]
    assert all(payload["data"]["mode"] == 0 for payload in navigation_payloads)
