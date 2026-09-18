import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

import car_integration


def test_alignment_ready_in_standalone_mode():
    car_integration.car_alignment.clear()
    car_integration.car_alignment.update({
        "status": "standalone",
        "message": "Mod direct mașinuță activ (coordonate native car_map).",
    })
    assert car_integration.alignment_ready() is True


def test_standalone_endpoint_resets_transform():
    async def _run():
        car_integration.car_transform.update({"x": 5.0, "y": -2.0, "yaw": 1.5})
        car_integration.car_alignment["status"] = "failed"
        result = await car_integration.set_car_standalone_mode()
        assert result["success"] is True
        assert car_integration.car_alignment["status"] == "standalone"
        assert car_integration.car_transform["x"] == 0.0
        assert car_integration.car_transform["y"] == 0.0
        assert car_integration.car_transform["yaw"] == 0.0
        assert car_integration.alignment_ready() is True
    asyncio.run(_run())


def test_preview_and_goal_unblock_car_in_unaligned_mode():
    async def _run():
        # Simulate connected car WebSocket
        mock_ws = AsyncMock()
        car_integration.car_ws = mock_ws
        car_integration.car_state["connected"] = True
        car_integration.car_alignment["status"] = "failed"
        car_integration.pending_preview = None

        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value={"x": 2.5, "y": 1.0, "yaw_deg": 45.0})

        # Calling preview_car_path should not return 409, but rather auto-promote to standalone and succeed
        res = await car_integration.preview_car_path(mock_request)
        assert isinstance(res, dict)
        assert res["success"] is True
        assert car_integration.car_alignment["status"] == "standalone"
        assert car_integration.pending_preview is not None
        req_id = res["request_id"]

        # Now test sending goal with that preview_id (after car planner marks preview ready)
        car_integration.pending_preview["ready"] = True
        mock_goal_request = MagicMock()
        mock_goal_request.json = AsyncMock(return_value={
            "x": 2.5, "y": 1.0, "yaw_deg": 45.0, "preview_id": req_id,
        })
        goal_res = await car_integration.send_car_goal(mock_goal_request)
        assert isinstance(goal_res, dict)
        assert goal_res["success"] is True
        assert mock_ws.send_text.called

        # Cleanup
        car_integration.car_ws = None
        car_integration.car_state["connected"] = False
    asyncio.run(_run())


def test_refine_alignment_icp_converges_from_rough_guess():
    import math
    import numpy as np

    # Synthetic room walls
    walls = []
    for x in np.linspace(0, 6, 60):
        walls.append((float(x), 0.0))
        walls.append((float(x), 5.0))
    for y in np.linspace(0, 5, 50):
        walls.append((0.0, float(y)))
        walls.append((6.0, float(y)))

    target_points = walls
    true_x, true_y, true_yaw = 2.0, -1.0, math.radians(18.0)
    cos_a, sin_a = math.cos(true_yaw), math.sin(true_yaw)
    source_points = []
    for tx, ty in target_points:
        dx, dy = tx - true_x, ty - true_y
        sx = cos_a * dx + sin_a * dy
        sy = -sin_a * dx + cos_a * dy
        source_points.append({"x": sx, "y": sy})

    # Initial guess with offset (0.4m error and 8 deg error)
    init_x = true_x + 0.4
    init_y = true_y - 0.3
    init_yaw = true_yaw + math.radians(8.0)

    result = car_integration.refine_alignment_icp(
        target_points, source_points, init_x, init_y, init_yaw
    )
    assert abs(result["x"] - true_x) < 0.05
    assert abs(result["y"] - true_y) < 0.05
    assert abs(result["yaw"] - true_yaw) < math.radians(1.5)
    assert result["overlap"] > 0.85
    assert result["rmse_m"] < 0.06

