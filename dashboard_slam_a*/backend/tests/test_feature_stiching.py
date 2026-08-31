import math

import numpy as np
import pytest

from feature_stiching import align_point_maps, estimate_rigid_transform


def _transform(points, x, y, yaw):
    rotation = np.asarray([
        [math.cos(yaw), -math.sin(yaw)],
        [math.sin(yaw), math.cos(yaw)],
    ])
    return (rotation @ np.asarray(points).T).T + np.asarray([x, y])


def test_estimate_rigid_transform_has_no_scale_component():
    source = np.asarray([
        [-2.0, -1.0], [0.0, 0.0], [4.0, 1.0], [1.0, 5.0],
    ])
    expected_x, expected_y, expected_yaw = 2.4, -1.7, math.radians(23.0)
    target = _transform(source, expected_x, expected_y, expected_yaw)

    x, y, yaw, residuals = estimate_rigid_transform(target, source)

    assert x == pytest.approx(expected_x, abs=1e-9)
    assert y == pytest.approx(expected_y, abs=1e-9)
    assert yaw == pytest.approx(expected_yaw, abs=1e-9)
    assert np.max(residuals) < 1e-9


def test_feature_alignment_recovers_asymmetric_map_transform():
    segments = [
        ((0, 0), (8, 0)), ((0, 0), (0, 5)), ((0, 5), (3, 5)),
        ((3, 2), (3, 5)), ((3, 2), (7, 2)), ((7, 2), (7, 4)),
        ((5, 4), (7, 4)), ((5, 4), (5, 7)), ((5, 7), (10, 7)),
        ((10, 3), (10, 7)),
    ]
    source = []
    for start, end in segments:
        source.extend([
            (
                start[0] + (end[0] - start[0]) * amount,
                start[1] + (end[1] - start[1]) * amount,
            )
            for amount in np.linspace(0.0, 1.0, 150)
        ])
    source = np.asarray(source)
    expected_x, expected_y, expected_yaw = 2.4, -1.7, math.radians(23.0)
    target = _transform(source, expected_x, expected_y, expected_yaw)

    result = align_point_maps(target, source, resolution=0.05)

    assert result["accepted"] is True
    assert result["x"] == pytest.approx(expected_x, abs=0.08)
    assert result["y"] == pytest.approx(expected_y, abs=0.08)
    assert result["yaw"] == pytest.approx(expected_yaw, abs=math.radians(1.5))
    assert result["overlap"] > 0.90
    assert result["rmse_m"] < 0.10
