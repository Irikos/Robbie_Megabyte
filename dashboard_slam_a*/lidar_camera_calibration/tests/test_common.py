from types import SimpleNamespace

import cv2
import numpy as np

from common import (
    fit_plane_ransac,
    pointcloud2_xyz,
    rotation_matrix_to_quaternion,
    solve_plane_extrinsic,
)


def test_pointcloud2_xyz_decodes_offsets_and_filters_nonfinite_points():
    dtype = np.dtype({
        "names": ["x", "y", "z", "intensity"],
        "formats": ["<f4", "<f4", "<f4", "<f4"],
        "offsets": [0, 4, 8, 12],
        "itemsize": 16,
    })
    raw = np.zeros(3, dtype=dtype)
    raw["x"] = [1.0, np.nan, 7.0]
    raw["y"] = [2.0, 5.0, 8.0]
    raw["z"] = [3.0, 6.0, 9.0]
    fields = [
        SimpleNamespace(name=name, offset=offset, datatype=7, count=1)
        for name, offset in (("x", 0), ("y", 4), ("z", 8))
    ]
    message = SimpleNamespace(
        fields=fields,
        is_bigendian=False,
        height=1,
        width=3,
        point_step=16,
        row_step=48,
        data=raw.tobytes(),
    )
    points = pointcloud2_xyz(message)
    assert np.allclose(points, [[1, 2, 3], [7, 8, 9]])


def test_fit_plane_ransac_rejects_outliers():
    rng = np.random.default_rng(4)
    xy = rng.uniform(-1, 1, size=(600, 2))
    plane = np.column_stack((xy, 0.4 * xy[:, 0] - 0.2 * xy[:, 1] + 1.1))
    plane += rng.normal(0, 0.001, size=plane.shape)
    points = np.vstack((plane, rng.uniform(-2, 2, size=(100, 3))))
    result = fit_plane_ransac(points, threshold_m=0.008, iterations=500)
    expected = np.array([0.4, -0.2, -1.0])
    expected /= np.linalg.norm(expected)
    assert abs(float(result["normal"] @ expected)) > 0.999
    assert result["inlier_count"] >= 590
    assert result["rms_m"] < 0.003


def test_plane_correspondences_recover_lidar_to_camera_transform():
    rotation, _ = cv2.Rodrigues(np.array([0.18, -0.11, 0.07], dtype=np.float64))
    translation = np.array([0.08, -0.04, 0.13])
    lidar_normals = np.array([
        [1.0, 0.0, 0.2],
        [0.0, 1.0, 0.3],
        [0.2, -0.1, 1.0],
        [-0.6, 0.5, 0.7],
        [0.5, 0.8, -0.3],
        [-0.3, 0.9, 0.4],
    ])
    lidar_normals /= np.linalg.norm(lidar_normals, axis=1, keepdims=True)
    camera_normals = lidar_normals @ rotation.T
    camera_ds = np.full(len(lidar_normals), -1.4)
    lidar_ds = camera_normals @ translation + camera_ds
    result = solve_plane_extrinsic(lidar_normals, lidar_ds, camera_normals, camera_ds)
    assert np.allclose(result["rotation"], rotation, atol=1e-9)
    assert np.allclose(result["translation"], translation, atol=1e-9)
    assert result["normal_rms_deg"] < 1e-6
    assert result["distance_rms_m"] < 1e-9


def test_rotation_matrix_to_quaternion_round_trip():
    rotation, _ = cv2.Rodrigues(np.array([0.2, 0.1, -0.3], dtype=np.float64))
    x, y, z, w = rotation_matrix_to_quaternion(rotation)
    reconstructed, _ = cv2.Rodrigues(
        np.array([x, y, z]) / np.linalg.norm([x, y, z])
        * (2.0 * np.arctan2(np.linalg.norm([x, y, z]), w))
    )
    assert np.allclose(reconstructed, rotation, atol=1e-9)

