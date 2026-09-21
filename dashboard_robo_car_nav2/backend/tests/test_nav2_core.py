import asyncio
from pathlib import Path
from types import SimpleNamespace
import threading

import pytest

from nav2_runtime import Nav2Runtime, occupancy_from_points
from motion_adapter import BodyFrameTransform, VelocityLimits, ros_twist_to_unitree
from server import (
    NAV_ANGULAR_LIMIT,
    NAV_SPEED_MAX,
    TELEOP_ANGULAR_MAX,
    TELEOP_LINEAR_MAX,
    command_can_verify_actuation,
    locomotion_fsms_for_service,
    nav_safe_stream_state,
    navigation_target,
    teleop_speed_value,
    teleop_turn_speed_value,
    teleop_velocity_command,
)


ROOT = Path(__file__).resolve().parents[2]


def test_occupancy_marks_obstacle_and_closes_border():
    grid = occupancy_from_points([(0.0, 0.0, 0.5), (1.0, 1.0, 0.5)], resolution=0.1)
    assert grid["occupied"] >= 2
    assert all(value == 100 for value in grid["data"][: grid["width"]])
    assert all(value == 100 for value in grid["data"][-grid["width"] :])


def test_robot_footprint_is_cleared_only_at_start():
    grid = occupancy_from_points([(0.0, 0.0, 0.5), (1.0, 0.0, 0.5)], resolution=0.05, clear_xy=(0.0, 0.0))
    center_x = round((0.0 - grid["origin_x"]) / grid["resolution"])
    center_y = round((0.0 - grid["origin_y"]) / grid["resolution"])
    assert grid["data"][center_y * grid["width"] + center_x] == 0


def test_navigation_target_limits_speed():
    assert navigation_target({"x": 1, "y": 2, "yaw": 0, "speed": 0.3}) == (1.0, 2.0, 0.0, 0.3)
    for speed in (0.2, 0.81):
        with pytest.raises(ValueError):
            navigation_target({"x": 1, "y": 2, "yaw": 0, "speed": speed})


def test_teleop_speed_has_its_own_safe_range():
    assert teleop_speed_value(0.10) == 0.10
    assert teleop_speed_value("0.80") == 0.80
    for value in (0.09, 0.81, float("nan")):
        with pytest.raises(ValueError):
            teleop_speed_value(value)


def test_teleop_turn_speed_has_its_own_range():
    assert teleop_turn_speed_value(0.30) == 0.30
    assert teleop_turn_speed_value("1.60") == 1.60
    for value in (0.29, 1.61, float("nan")):
        with pytest.raises(ValueError):
            teleop_turn_speed_value(value)


def test_teleop_speed_scales_the_real_locomotion_command_once():
    assert teleop_velocity_command((0.20, 0.0, 0.30), 0.80, 1.60) == (0.80, 0.0, 1.60)
    assert teleop_velocity_command((-0.20, 0.0, -0.30), 0.10, 0.80) == (-0.10, 0.0, -0.80)


def test_manual_ros_to_unitree_transform_uses_body_axes_without_hidden_gain():
    command = ros_twist_to_unitree((0.42, -0.12, 0.73), forward_limit=0.80)
    assert command == (0.42, -0.12, 0.73)
    assert ros_twist_to_unitree((0.0, 0.0, 0.0)) == (0.0, 0.0, 0.0)
    # O reducere produsă de Collision Monitor nu este ridicată la un prag minim.
    assert ros_twist_to_unitree((0.03, 0.0, 0.04)) == (0.03, 0.0, 0.04)


def test_manual_transform_clamps_each_axis_and_can_make_signs_explicit():
    limits = VelocityLimits(forward=0.80, reverse=0.35, lateral=0.25, angular=1.60)
    assert ros_twist_to_unitree((2.0, -2.0, 3.0), limits=limits) == (0.80, -0.25, 1.60)
    assert ros_twist_to_unitree((-2.0, 2.0, -3.0), limits=limits) == (-0.35, 0.25, -1.60)
    inverted = BodyFrameTransform(x_sign=1, y_sign=-1, yaw_sign=-1)
    assert ros_twist_to_unitree((0.2, 0.1, 0.4), transform=inverted) == (0.2, -0.1, -0.4)


def test_ros2_transport_is_used_without_unitree_python_sdk():
    source = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "from unitree_api.msg import Request, Response" in source
    assert "import unitree_sdk2py" not in source
    assert "from unitree_sdk2py" not in source


def test_native_navigation_is_guarded_and_not_called():
    source = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "await command(1102" not in source
    assert "await command(1201" not in source
    assert "await command(1202" not in source
    assert "plan_xy_route" not in source
    assert "RouteTracker" not in source
    assert "control_api, control_payload = 7111, {\"data\": 2}" in source
    assert "control_api, control_payload = 7110, {\"data\": False}" in source
    assert "DIRECT_CONTROL_FSMS = frozenset({500, 501, 502})" in source
    assert '"/api/motion_switcher/request"' in source
    assert '"/api/motion_switcher/response"' in source


def test_nav2_pipeline_has_one_safe_output():
    launch = (ROOT / "nav2" / "bringup.launch.py").read_text(encoding="utf-8")
    config = (ROOT / "nav2" / "nav2.yaml").read_text(encoding="utf-8")
    assert "/nav2/cmd_vel_safe" in config
    assert "collision_monitor" in launch
    assert config.count("inflation_radius:") == 2  # one for each distinct costmap
    assert "polygons: [DirectionalApproach]" in config
    assert "action_type: approach" in config
    assert "action_type: stop" not in config


def test_every_velocity_stage_and_yaw_error_are_observable():
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert '"raw_velocity"' in runtime
    assert '"smoothed_velocity"' in runtime
    assert '"safe_velocity"' in runtime
    assert '"nav2_velocity"' in runtime
    assert '"last_ros_velocity"' in server
    assert '"yaw_diagnostics"' in server
    for element_id in ("diag-nav2", "diag-raw", "diag-smoothed", "diag-safe", "diag-sport", "diag-yaw"):
        assert f'id="{element_id}"' in frontend


def test_teleop_and_nav2_are_separate_sources_before_safety_pipeline():
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    launch = (ROOT / "nav2" / "bringup.launch.py").read_text(encoding="utf-8")
    assert '"/cmd_vel_teleop"' in runtime
    assert '"/nav2/cmd_vel_nav2"' in runtime
    assert runtime.count('create_publisher(Twist, "/nav2/cmd_vel_raw"') == 1
    assert 'if source == "teleop" or not selected:' in runtime
    assert '("cmd_vel", "/nav2/cmd_vel_nav2")' in launch
    assert '("cmd_vel", "/nav2/cmd_vel_raw")' in launch


def test_teleop_validation_bypasses_nav2_lifecycle_but_keeps_watchdog():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    assert 'node.nav2.source_velocity("teleop")' in server
    assert 'else node.nav2.safe_velocity()' in server
    assert 'if command_stale and owner == "teleop":' in server
    assert '"teleop_path": "direct_to_sport_with_watchdog"' in server
    assert "TELEOP_PROGRESS_TIMEOUT = 1.50" in server
    assert "def source_velocity(" in runtime


def test_keyboard_launcher_uses_dedicated_topic_and_safe_initial_speed():
    launcher = (ROOT / "start_teleop_keyboard.sh").read_text(encoding="utf-8")
    assert "teleop_twist_keyboard teleop_twist_keyboard" in launcher
    assert "cmd_vel:=/cmd_vel_teleop" in launcher
    assert "speed:=0.20" in launcher
    assert "turn:=0.30" in launcher


def test_dashboard_owns_keyboard_process_and_browser_key_endpoint():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "class TeleopKeyboardProcess" in server
    assert 'pty.openpty()' in server
    assert '@app.post("/api/teleop/key")' in server
    assert '@app.post("/api/teleop/speed")' in server
    assert 'cmd_vel:=/cmd_vel_teleop' in server
    assert 'os.write(master_fd, b"k")' in server
    assert 'window.addEventListener("keyup"' in frontend
    assert 'window.addEventListener("blur"' in frontend
    assert 'sendTeleopKey("k")' in frontend
    assert '$("teleop-capture").focus({ preventScroll: true })' in frontend
    assert 'KeyW: "i"' in frontend
    assert 'activeTeleopKey !== null && teleopIsEnabled()' in frontend
    assert '"teleop_last_key_age"' in server
    assert 'const odomAge = next.base_odom_age' in frontend
    assert 'Tasta ${JSON.stringify(locomotion.teleop_last_key)} a ajuns · cmd_vel primit, aștept API 7105' in frontend
    assert 'Tasta ${JSON.stringify(locomotion.teleop_last_key)} a ajuns · API 7105 acceptat' in frontend
    assert 'id="teleop-speed"' in (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert 'id="teleop-turn-speed"' in (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert 'speed: Number($("teleop-speed").value)' in frontend
    assert 'turn_speed: Number($("teleop-turn-speed").value)' in frontend
    assert "velocity, teleop_speed, teleop_turn_speed" in server


def test_velocity_limits_are_consistent_and_only_bridge_writes_nonzero_sport_command():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    config = (ROOT / "nav2" / "nav2.yaml").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert NAV_SPEED_MAX == TELEOP_LINEAR_MAX == 0.80
    assert NAV_ANGULAR_LIMIT == TELEOP_ANGULAR_MAX == 1.60
    assert "desired_linear_vel: 0.80" in config
    assert "max_velocity: [0.80, 0.25, 1.60]" in config
    assert "rotate_to_heading_angular_vel: 1.60" in config
    # Orientarea finală este acum verificată explicit în cod (Spin,
    # FINAL_YAW_TOLERANCE = 0.12), nu prin goal_checker — RPP Humble nu
    # rotește niciodată spre yaw-ul goal-ului, doar spre traseu.
    assert "yaw_goal_tolerance: 3.20" in config
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    assert "FINAL_YAW_TOLERANCE = 0.12" in runtime
    assert '"orienting"' in runtime
    assert "max_accel: [1.10, 0.55, 4.00]" in config
    assert 'id="speed" type="range" min="0.30" max="0.80"' in frontend
    assert 'id="teleop-speed" type="range" min="0.10" max="0.80"' in frontend
    assert 'id="teleop-turn-speed" type="range" min="0.30" max="1.60"' in frontend
    assert server.count("result = await send_velocity(vx, vy, wz, ros_velocity=ros_velocity)") == 1
    assert server.count('7105, {"velocity": values') == 1
    assert server.count('Request, "/api/sport/request", reliable_qos') == 1


def test_obstacle_clearance_is_compact_but_collision_checks_stay_enabled():
    config = (ROOT / "nav2" / "nav2.yaml").read_text(encoding="utf-8")
    assert config.count("footprint_padding: 0.01") == 2
    assert config.count(
        'footprint: "[[0.34, 0.25], [0.34, -0.25], '
        '[-0.25, -0.25], [-0.25, 0.25]]"'
    ) == 2
    assert config.count("inflation_radius: 0.28") == 2
    assert config.count("cost_scaling_factor: 8.0") == 2
    assert "use_collision_detection: true" in config
    assert "action_type: approach" in config
    assert "time_before_collision: 1.00" in config
    assert "action_type: stop" not in config


def test_dynamic_obstacle_replanning_does_not_erase_live_obstacles():
    tree = (ROOT / "nav2" / "navigate_replanning.xml").read_text(encoding="utf-8")
    assert '<RateController hz="2.0">' in tree
    assert "ComputePathToPose" in tree
    assert "FollowPath" in tree
    assert "ClearEntireCostmap" not in tree


def _nav_path(points):
    return SimpleNamespace(
        header=SimpleNamespace(frame_id="map"),
        poses=[
            SimpleNamespace(pose=SimpleNamespace(position=SimpleNamespace(x=x, y=y)))
            for x, y in points
        ],
    )


def test_live_nav2_plan_replaces_displayed_route_and_counts_replans():
    runtime = Nav2Runtime.__new__(Nav2Runtime)
    runtime.lock = threading.RLock()
    runtime.state_callback = None
    runtime._plan_at = 0.0
    runtime._plan_revision = 0
    runtime._replan_count = 0
    runtime._status = {"state": "navigating", "path": [], "path_live": False}

    runtime._live_plan(_nav_path([(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)]))
    assert runtime._status["path"] == [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]
    assert runtime._status["path_live"] is True
    assert runtime._plan_revision == 1
    assert runtime._replan_count == 0

    runtime._live_plan(_nav_path([(0.1, 0.0), (0.8, 0.6), (2.0, 0.0)]))
    assert runtime._status["path"] == [[0.1, 0.0], [0.8, 0.6], [2.0, 0.0]]
    assert runtime._status["path_source"] == "nav2_replan"
    assert runtime._plan_revision == 2
    assert runtime._replan_count == 1


def test_v4_frontend_consumes_live_nav2_path():
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    assert 'NavPath, "/plan", self._live_plan' in runtime
    assert "navigation.path_revision" in frontend
    assert "navigation.path_live" in frontend
    assert "updateLiveNavigationPath(navigation)" in frontend
    assert 'ctx.strokeStyle = "#fff200"' in frontend
    assert "ctx.lineWidth = 20" in frontend
    assert "ctx.lineWidth = 5" in frontend
    assert 'routePreview.live ? [] : [20, 12]' in frontend
    car_frontend = (ROOT / "frontend" / "car.js").read_text(encoding="utf-8")
    assert "car.path_revision" in car_frontend
    assert "car-path-live" in car_frontend


def test_v4_loads_textured_car_model_with_fallback():
    page = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    view3d = (ROOT / "frontend" / "view3d.js").read_text(encoding="utf-8")
    assert "OBJLoader.js" in page
    assert 'const assetRoot = "/static/assets/car/model_masina"' in view3d
    assert "`${assetRoot}/3DModel.obj`" in view3d
    assert "`${assetRoot}/3DModel.jpg`" in view3d
    assert "carFallbackMesh.visible = false" in view3d


def test_nav2_watchdog_distinguishes_replanning_from_broken_safety_pipeline():
    now = 10.0
    assert nav_safe_stream_state(9.50, 9.90, now) == "fresh"
    assert nav_safe_stream_state(8.00, 9.90, now) == "broken"
    assert nav_safe_stream_state(8.00, 9.90, now, (0.2, 0.0, 0.0)) == "broken"
    # Collision Monitor oprește intenționat publicarea zerourilor după
    # stop_pub_timeout; aceasta este stare de repaus, nu pipeline defect.
    assert nav_safe_stream_state(8.00, 9.90, now, (0.0, 0.0, 0.0)) == "waiting"
    assert nav_safe_stream_state(8.00, 8.00, now) == "waiting"
    assert nav_safe_stream_state(0.00, 0.00, now) == "waiting"


def test_replanning_stop_uses_smoother_and_collision_monitor_before_7105():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    config = (ROOT / "nav2" / "nav2.yaml").read_text(encoding="utf-8")
    assert "node.nav2.request_smooth_stop()" in server
    assert "def request_smooth_stop(self)" in runtime
    assert "self.raw_cmd_publisher.publish(Twist())" in runtime
    assert "if self._smooth_stop_active:" in runtime
    assert "max_decel: [-0.50, -0.40, -2.00]" in config
    assert "velocity_timeout: 0.25" in config
    assert "NAV_PIPELINE_RECOVERY_GRACE = 2.00" in server


def test_smooth_stop_cannot_override_first_nav2_command_or_repeat_forever():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "and nav_received_at > 0.0" in server
    assert 'and not runtime_status.get("smooth_stop_active", False)' in server
    assert "nav_received_at <= 0.0\n            and now - node.motion_armed_at > 2.5" in server
    assert "controller_server nu publică prima comandă" in server


def test_path_tracking_and_scan_timeout_are_not_overly_aggressive():
    config = (ROOT / "nav2" / "nav2.yaml").read_text(encoding="utf-8")
    assert "controller_frequency: 20.0" in config
    assert "lookahead_dist: 0.40" in config
    assert "max_lookahead_dist: 0.65" in config
    assert "rotate_to_heading_min_angle: 0.785" in config
    # La 20 Hz, limita internă trebuie să permită întreaga comandă de 1.60
    # rad/s chiar dacă odometria rămâne momentan la zero: 32 / 20 = 1.60.
    assert "max_angular_accel: 32.00" in config
    assert "rotational_acc_lim: 32.0" in config
    # Accelerația trimisă fizic rămâne netezită separat.
    assert "max_accel: [1.10, 0.55, 4.00]" in config
    assert "source_timeout: 0.60" in config
    assert "max_points: 5" in config


def test_actuation_probe_ignores_only_the_small_smoother_ramp():
    assert not command_can_verify_actuation(0.0, 0.0, 0.20)
    assert command_can_verify_actuation(0.0, 0.0, 0.25)
    assert command_can_verify_actuation(0.08, 0.0, 0.0)


def test_motion_service_selects_one_matching_fsm_family():
    assert locomotion_fsms_for_service("ai") == {801, 802, 812}
    assert locomotion_fsms_for_service("normal") == {500, 501, 502}
    with pytest.raises(ValueError):
        locomotion_fsms_for_service("")


def test_active_motion_service_is_read_before_run_activation():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "service_state = await read_motion_service()" in server
    assert "locomotion_fsm = await set_and_confirm_fsm(" in server
    assert "current = await activate_run_mode()" in server


@pytest.mark.parametrize(
    ("service_name", "initial_fsm", "control_call", "requested_fsm", "expected_fsms", "control_name"),
    [
        ("ai", 4, (7111, {"data": 2}), 801, {801, 802, 812}, "internal_ai"),
        ("normal", 4, (7110, {"data": False}), 500, {500, 501, 502}, "external_user"),
    ],
)
def test_run_activation_matches_motion_switcher_service(
    monkeypatch, service_name, initial_fsm, control_call,
    requested_fsm, expected_fsms, control_name,
):
    import server as server_module

    calls = []
    node = SimpleNamespace(
        lock=threading.RLock(), teleop_verified=False, teleop_error="",
        run_profile_accepted=False,
    )

    async def read_robot_fsm():
        return {"success": True, "fsm_id": initial_fsm}

    async def read_motion_service():
        return {"success": True, "service_name": service_name, "service_form": "0"}

    async def command(api_id, payload, **_kwargs):
        calls.append((api_id, payload))
        return {"success": True}

    async def set_and_confirm(requested, expected, **_kwargs):
        calls.append((7101, {"data": requested}))
        assert requested == requested_fsm
        assert expected == expected_fsms
        return {"success": True, "fsm_id": requested_fsm}

    async def no_delay(_seconds):
        return None

    monkeypatch.setattr(server_module, "ros", lambda: node)
    monkeypatch.setattr(server_module, "read_robot_fsm", read_robot_fsm)
    monkeypatch.setattr(server_module, "read_motion_service", read_motion_service)
    monkeypatch.setattr(server_module, "command", command)
    monkeypatch.setattr(server_module, "set_and_confirm_fsm", set_and_confirm)
    monkeypatch.setattr(server_module.asyncio, "sleep", no_delay)

    result = asyncio.run(server_module.activate_run_mode())
    assert result == {
        "success": True,
        "fsm_id": requested_fsm,
        "control": control_name,
        "motion_service": service_name,
    }
    assert calls == [
        control_call,
        (7101, {"data": requested_fsm}),
        (7107, {"data": 1}),
    ]


def test_teleop_idle_does_not_trip_safe_output_watchdog():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    runtime = (ROOT / "backend" / "nav2_runtime.py").read_text(encoding="utf-8")
    assert 'runtime_status.get("teleop_velocity", (0.0, 0.0, 0.0))' in server
    assert "if command_stale and teleop_idle and not health:" in server
    assert "key in TeleopKeyboardProcess.MOTION_KEYS" in server
    assert "node.motion_armed_at = time.monotonic()" in server
    assert "self._source_velocity[mode] = (0.0, 0.0, 0.0)" in runtime
    assert "self._source_cmd_at[mode] = 0.0" in runtime


def test_map_viewport_expands_to_canvas_aspect_before_zoom():
    frontend = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "function boundsForViewport" in frontend
    assert "targetAspect = usableWidth / usableHeight" in frontend
    assert "const visibleBounds = view.bounds" in frontend
    assert "startBounds: { ...view.bounds }" in frontend


def test_saving_a_map_cannot_overwrite_an_existing_pcd():
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert "if target.exists() or target_2d.exists():" in server
    assert "V3 nu suprascrie hărți PCD existente" in server
