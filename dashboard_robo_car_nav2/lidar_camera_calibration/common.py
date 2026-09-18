"""Dependency-light helpers shared by the capture and solve commands."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable
import json
import math

import cv2
import numpy as np


@dataclass(frozen=True)
class BoardSpec:
    squares_x: int = 6
    squares_y: int = 4
    square_length_m: float = 0.060
    marker_length_m: float = 0.042
    dictionary: str = "DICT_5X5_100"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def make_charuco_board(spec: BoardSpec):
    if not hasattr(cv2, "aruco"):
        raise RuntimeError("OpenCV was built without the aruco module (install opencv-contrib-python).")
    dictionary_id = getattr(cv2.aruco, spec.dictionary, None)
    if dictionary_id is None:
        raise ValueError(f"Unknown ArUco dictionary: {spec.dictionary}")
    dictionary = cv2.aruco.getPredefinedDictionary(dictionary_id)
    size = (spec.squares_x, spec.squares_y)
    # OpenCV 4.6 exposes the newer symbol, but that Python constructor can
    # segfault; its factory is the stable API on JetPack.
    if hasattr(cv2.aruco, "CharucoBoard_create"):
        board = cv2.aruco.CharucoBoard_create(
            spec.squares_x,
            spec.squares_y,
            spec.square_length_m,
            spec.marker_length_m,
            dictionary,
        )
    else:
        board = cv2.aruco.CharucoBoard(
            size, spec.square_length_m, spec.marker_length_m, dictionary
        )
    return dictionary, board


def detect_charuco(image: np.ndarray, spec: BoardSpec) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return subpixel ChArUco corners, ids, and a display overlay."""
    dictionary, board = make_charuco_board(spec)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    marker_corners, marker_ids, _ = cv2.aruco.detectMarkers(gray, dictionary)
    display = image.copy()
    if marker_ids is None or not len(marker_ids):
        return np.empty((0, 2), np.float32), np.empty((0,), np.int32), display
    cv2.aruco.drawDetectedMarkers(display, marker_corners, marker_ids)
    count, corners, ids = cv2.aruco.interpolateCornersCharuco(
        marker_corners, marker_ids, gray, board
    )
    if corners is None or ids is None or count is None or count <= 0:
        return np.empty((0, 2), np.float32), np.empty((0,), np.int32), display
    corners_2d = np.asarray(corners, dtype=np.float32).reshape(-1, 2)
    ids_1d = np.asarray(ids, dtype=np.int32).reshape(-1)
    cv2.aruco.drawDetectedCornersCharuco(
        display, corners_2d.reshape(-1, 1, 2), ids_1d.reshape(-1, 1)
    )
    return corners_2d, ids_1d, display


def _board_chessboard_corners(board) -> np.ndarray:
    if hasattr(board, "getChessboardCorners"):
        return np.asarray(board.getChessboardCorners(), dtype=np.float64).reshape(-1, 3)
    return np.asarray(board.chessboardCorners, dtype=np.float64).reshape(-1, 3)


def camera_board_plane(
    image: np.ndarray,
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    spec: BoardSpec,
    min_corners: int = 8,
) -> dict[str, Any]:
    """Estimate the target plane in the camera optical frame."""
    _, board = make_charuco_board(spec)
    image_points, ids, _ = detect_charuco(image, spec)
    if len(ids) < min_corners:
        raise ValueError(f"Only {len(ids)} ChArUco corners detected; need {min_corners}.")
    all_object_points = _board_chessboard_corners(board)
    object_points = all_object_points[ids]
    ok, rvec, tvec = cv2.solvePnP(
        object_points,
        image_points,
        np.asarray(camera_matrix, dtype=np.float64),
        np.asarray(distortion, dtype=np.float64),
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        raise ValueError("cv2.solvePnP could not estimate the ChArUco board pose.")
    rotation, _ = cv2.Rodrigues(rvec)
    normal = rotation[:, 2].astype(np.float64)
    normal /= np.linalg.norm(normal)
    translation = np.asarray(tvec, dtype=np.float64).reshape(3)
    distance_term = -float(normal @ translation)
    if distance_term > 0.0:
        normal = -normal
        distance_term = -distance_term
    projected, _ = cv2.projectPoints(
        object_points, rvec, tvec, camera_matrix, distortion
    )
    reprojection = projected.reshape(-1, 2) - image_points
    rms = float(np.sqrt(np.mean(np.sum(reprojection * reprojection, axis=1))))
    return {
        "normal": normal,
        "d": distance_term,
        "rvec": np.asarray(rvec).reshape(3),
        "tvec": translation,
        "corner_count": int(len(ids)),
        "reprojection_rms_px": rms,
        "ids": ids,
        "image_points": image_points,
    }


_POINT_FIELD_DTYPES = {
    1: "i1",  # INT8
    2: "u1",  # UINT8
    3: "i2",  # INT16
    4: "u2",  # UINT16
    5: "i4",  # INT32
    6: "u4",  # UINT32
    7: "f4",  # FLOAT32
    8: "f8",  # FLOAT64
}


def pointcloud2_xyz(message: Any) -> np.ndarray:
    """Decode x/y/z from a sensor_msgs/PointCloud2 without sensor_msgs_py."""
    fields = {field.name: field for field in message.fields}
    missing = {name for name in ("x", "y", "z") if name not in fields}
    if missing:
        raise ValueError(f"PointCloud2 is missing fields: {sorted(missing)}")
    endian = ">" if bool(message.is_bigendian) else "<"
    height = max(1, int(message.height))
    width = int(message.width)
    values: list[np.ndarray] = []
    buffer = memoryview(message.data)
    for name in ("x", "y", "z"):
        field = fields[name]
        code = _POINT_FIELD_DTYPES.get(int(field.datatype))
        if code is None or int(getattr(field, "count", 1)) != 1:
            raise ValueError(f"Unsupported PointCloud2 field {name} datatype/count")
        array = np.ndarray(
            shape=(height, width),
            dtype=np.dtype(endian + code),
            buffer=buffer,
            offset=int(field.offset),
            strides=(int(message.row_step), int(message.point_step)),
        )
        values.append(np.asarray(array, dtype=np.float32).reshape(-1))
    points = np.column_stack(values)
    return points[np.isfinite(points).all(axis=1)]


def voxel_downsample(points: np.ndarray, voxel_size: float) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(-1, 3)
    if voxel_size <= 0.0 or not len(points):
        return points
    keys = np.floor(points / float(voxel_size)).astype(np.int32)
    _, indices = np.unique(keys, axis=0, return_index=True)
    return points[np.sort(indices)]


def fit_plane_ransac(
    points: np.ndarray,
    threshold_m: float = 0.015,
    iterations: int = 800,
    seed: int = 1,
) -> dict[str, Any]:
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if len(points) < 30:
        raise ValueError("At least 30 selected LiDAR points are required.")
    rng = np.random.default_rng(seed)
    best = np.empty((0,), dtype=np.int64)
    for _ in range(iterations):
        sample = points[rng.choice(len(points), 3, replace=False)]
        normal = np.cross(sample[1] - sample[0], sample[2] - sample[0])
        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            continue
        normal /= norm
        d = -float(normal @ sample[0])
        inliers = np.flatnonzero(np.abs(points @ normal + d) <= threshold_m)
        if len(inliers) > len(best):
            best = inliers
    if len(best) < 30:
        raise ValueError("No stable plane was found inside the selected LiDAR region.")
    centroid = points[best].mean(axis=0)
    _, _, vh = np.linalg.svd(points[best] - centroid, full_matrices=False)
    normal = vh[-1]
    normal /= np.linalg.norm(normal)
    d = -float(normal @ centroid)
    if d > 0.0:
        normal = -normal
        d = -d
    residuals = points[best] @ normal + d
    return {
        "normal": normal,
        "d": d,
        "centroid": centroid,
        "inlier_indices": best,
        "inlier_count": int(len(best)),
        "selected_count": int(len(points)),
        "rms_m": float(np.sqrt(np.mean(residuals * residuals))),
    }


def solve_plane_extrinsic(
    lidar_normals: Iterable[Iterable[float]],
    lidar_ds: Iterable[float],
    camera_normals: Iterable[Iterable[float]],
    camera_ds: Iterable[float],
) -> dict[str, Any]:
    """Solve x_camera = R * x_lidar + t from corresponding planes."""
    lidar_n = np.asarray(list(lidar_normals), dtype=np.float64).reshape(-1, 3)
    camera_n = np.asarray(list(camera_normals), dtype=np.float64).reshape(-1, 3)
    lidar_d = np.asarray(list(lidar_ds), dtype=np.float64).reshape(-1)
    camera_d = np.asarray(list(camera_ds), dtype=np.float64).reshape(-1)
    if len(lidar_n) < 3 or len(camera_n) != len(lidar_n):
        raise ValueError("At least three corresponding planes are required.")
    lidar_n /= np.linalg.norm(lidar_n, axis=1, keepdims=True)
    camera_n /= np.linalg.norm(camera_n, axis=1, keepdims=True)
    u, _, vt = np.linalg.svd(lidar_n.T @ camera_n)
    rotation = vt.T @ u.T
    if np.linalg.det(rotation) < 0:
        vt[-1] *= -1
        rotation = vt.T @ u.T
    rhs = lidar_d - camera_d
    translation, _, _, singular_values = np.linalg.lstsq(camera_n, rhs, rcond=None)
    normal_errors = np.degrees(np.arccos(np.clip(
        np.sum((lidar_n @ rotation.T) * camera_n, axis=1), -1.0, 1.0
    )))
    distance_errors = camera_n @ translation + camera_d - lidar_d
    condition = math.inf
    if len(singular_values) and singular_values[-1] > 0:
        condition = float(singular_values[0] / singular_values[-1])
    return {
        "rotation": rotation,
        "translation": translation,
        "normal_errors_deg": normal_errors,
        "distance_errors_m": distance_errors,
        "normal_rms_deg": float(np.sqrt(np.mean(normal_errors * normal_errors))),
        "distance_rms_m": float(np.sqrt(np.mean(distance_errors * distance_errors))),
        "translation_condition": condition,
    }


def rotation_matrix_to_quaternion(rotation: np.ndarray) -> np.ndarray:
    """Return an xyzw quaternion for a proper 3x3 rotation matrix."""
    matrix = np.asarray(rotation, dtype=np.float64)
    # OpenCV provides a stable matrix -> axis-angle conversion.
    rvec, _ = cv2.Rodrigues(matrix)
    angle = float(np.linalg.norm(rvec))
    if angle < 1e-12:
        return np.array([0.0, 0.0, 0.0, 1.0])
    axis = rvec.reshape(3) / angle
    return np.r_[axis * math.sin(angle / 2.0), math.cos(angle / 2.0)]

