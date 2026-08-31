"""Feature-based alignment for a 2D OccupancyGrid and a projected PCD map.

The original image-to-image demo is still available through ``main``.  The
dashboard uses :func:`align_point_maps`, which rasterizes XY obstacle points,
finds visual correspondences, and returns a rigid car-map -> G1-map transform.
"""

from dataclasses import dataclass
import math
from typing import Iterable, Tuple

import cv2
import numpy as np


IMAGE_A_PATH = "/home/remus/Downloads/harta_14aug_2d_clean_A.pgm"
IMAGE_B_PATH = "/home/remus/Downloads/harta_14aug_2d_clean_B.png"
DISPLAY_SCALE = 4.0


@dataclass
class RasterizedMap:
    image: np.ndarray
    world_to_pixel: np.ndarray
    pixel_to_world: np.ndarray
    resolution: float
    point_count: int


def find_image_correspondences(
    image_a: np.ndarray, image_b: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, list, list, list]:
    """Find RANSAC-consistent feature matches from image B into image A."""
    if hasattr(cv2, "SIFT_create"):
        detector = cv2.SIFT_create(
            nfeatures=8000, contrastThreshold=0.01, edgeThreshold=15
        )
        norm = cv2.NORM_L2
    else:
        detector = cv2.ORB_create(nfeatures=8000, fastThreshold=5)
        norm = cv2.NORM_HAMMING

    keypoints_a, descriptors_a = detector.detectAndCompute(image_a, None)
    keypoints_b, descriptors_b = detector.detectAndCompute(image_b, None)
    if descriptors_a is None or descriptors_b is None:
        raise ValueError("Nu am găsit suficiente trăsături în una dintre hărți")

    neighbours = cv2.BFMatcher(norm).knnMatch(
        descriptors_b, descriptors_a, k=2
    )
    good_matches = []
    for candidates in neighbours:
        if len(candidates) != 2:
            continue
        match, second_match = candidates
        if match.distance < 0.75 * second_match.distance:
            good_matches.append(match)
    if len(good_matches) < 3:
        raise ValueError("Sunt necesare cel puțin trei potriviri fiabile")

    points_b = np.float32([
        keypoints_b[match.queryIdx].pt for match in good_matches
    ])
    points_a = np.float32([
        keypoints_a[match.trainIdx].pt for match in good_matches
    ])
    transform, inlier_mask = cv2.estimateAffinePartial2D(
        points_b,
        points_a,
        method=cv2.RANSAC,
        ransacReprojThreshold=4.0,
        maxIters=5000,
        confidence=0.995,
        refineIters=20,
    )
    if (
        transform is None
        or inlier_mask is None
        or np.count_nonzero(inlier_mask) < 3
    ):
        raise ValueError("Potrivirile nu definesc o transformare consistentă")

    inliers = inlier_mask.ravel().astype(bool)
    inlier_matches = [
        match for match, is_inlier in zip(good_matches, inliers) if is_inlier
    ]
    return (
        points_a[inliers],
        points_b[inliers],
        keypoints_a,
        keypoints_b,
        inlier_matches,
    )


def _xy_array(points: Iterable) -> np.ndarray:
    values = []
    for point in points:
        try:
            if isinstance(point, dict):
                x, y = float(point["x"]), float(point["y"])
            else:
                x, y = float(point[0]), float(point[1])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            values.append((x, y))
    result = np.asarray(values, dtype=np.float64)
    if result.shape[0] < 20:
        raise ValueError("Harta are prea puține puncte ocupate pentru aliniere")
    return result


def rasterize_point_map(
    points: Iterable,
    resolution: float = 0.08,
    padding_px: int = 24,
) -> RasterizedMap:
    """Render world XY obstacles as a feature-friendly grayscale map."""
    xy = _xy_array(points)
    resolution = max(0.02, float(resolution))
    minimum = np.min(xy, axis=0)
    maximum = np.max(xy, axis=0)
    extent = np.maximum(maximum - minimum, resolution)
    # Bound both memory use and feature-extraction time on very large maps.
    resolution = max(resolution, float(np.max(extent)) / 1600.0)
    width = int(math.ceil(extent[0] / resolution)) + 1 + 2 * padding_px
    height = int(math.ceil(extent[1] / resolution)) + 1 + 2 * padding_px
    left = minimum[0] - padding_px * resolution
    top = maximum[1] + padding_px * resolution
    world_to_pixel = np.asarray([
        [1.0 / resolution, 0.0, -left / resolution],
        [0.0, -1.0 / resolution, top / resolution],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    pixel_to_world = np.linalg.inv(world_to_pixel)

    homogeneous = np.column_stack((xy, np.ones(xy.shape[0])))
    pixels = (world_to_pixel @ homogeneous.T).T
    columns = np.rint(pixels[:, 0]).astype(np.int32)
    rows = np.rint(pixels[:, 1]).astype(np.int32)
    valid = (
        (columns >= 0) & (columns < width) &
        (rows >= 0) & (rows < height)
    )
    occupied = np.zeros((height, width), dtype=np.uint8)
    occupied[rows[valid], columns[valid]] = 255
    occupied = cv2.dilate(
        occupied, np.ones((3, 3), np.uint8), iterations=1
    )
    # A clipped distance field gives thin PCD/OccupancyGrid walls gradients and
    # corners that SIFT/ORB can recognize without inventing free-space data.
    distance = cv2.distanceTransform(
        (occupied == 0).astype(np.uint8), cv2.DIST_L2, 3
    )
    image = (20.0 + 235.0 * np.minimum(distance, 14.0) / 14.0).astype(
        np.uint8
    )
    return RasterizedMap(
        image=image,
        world_to_pixel=world_to_pixel,
        pixel_to_world=pixel_to_world,
        resolution=resolution,
        point_count=int(xy.shape[0]),
    )


def pixels_to_world(points: np.ndarray, raster: RasterizedMap) -> np.ndarray:
    points = np.asarray(points, dtype=np.float64).reshape((-1, 2))
    homogeneous = np.column_stack((points, np.ones(points.shape[0])))
    return (raster.pixel_to_world @ homogeneous.T).T[:, :2]


def estimate_rigid_transform(
    target_points: np.ndarray, source_points: np.ndarray
) -> Tuple[float, float, float, np.ndarray]:
    """Least-squares SE(2) transform mapping source points into target."""
    target = np.asarray(target_points, dtype=np.float64).reshape((-1, 2))
    source = np.asarray(source_points, dtype=np.float64).reshape((-1, 2))
    if target.shape != source.shape or target.shape[0] < 2:
        raise ValueError("Corespondențele SE(2) sunt invalide")
    source_center = np.mean(source, axis=0)
    target_center = np.mean(target, axis=0)
    covariance = (source - source_center).T @ (target - target_center)
    u_matrix, _, vt_matrix = np.linalg.svd(covariance)
    rotation = vt_matrix.T @ u_matrix.T
    if np.linalg.det(rotation) < 0.0:
        vt_matrix[-1, :] *= -1.0
        rotation = vt_matrix.T @ u_matrix.T
    translation = target_center - rotation @ source_center
    transformed = (rotation @ source.T).T + translation
    residuals = np.linalg.norm(transformed - target, axis=1)
    yaw = math.atan2(rotation[1, 0], rotation[0, 0])
    return float(translation[0]), float(translation[1]), float(yaw), residuals


def _overlap_ratio(
    target_points: np.ndarray,
    source_points: np.ndarray,
    x: float,
    y: float,
    yaw: float,
    cell_size: float,
) -> float:
    cell_size = max(0.08, float(cell_size) * 1.75)
    target_cells = {
        (int(round(px / cell_size)), int(round(py / cell_size)))
        for px, py in target_points
    }
    if not target_cells:
        return 0.0
    step = max(1, source_points.shape[0] // 20000)
    sampled = source_points[::step]
    cos_yaw, sin_yaw = math.cos(yaw), math.sin(yaw)
    mapped_x = x + cos_yaw * sampled[:, 0] - sin_yaw * sampled[:, 1]
    mapped_y = y + sin_yaw * sampled[:, 0] + cos_yaw * sampled[:, 1]
    hits = 0
    for px, py in zip(mapped_x, mapped_y):
        cell_x = int(round(px / cell_size))
        cell_y = int(round(py / cell_size))
        if any(
            (cell_x + dx, cell_y + dy) in target_cells
            for dx in (-1, 0, 1) for dy in (-1, 0, 1)
        ):
            hits += 1
    return hits / max(1, sampled.shape[0])


def align_point_maps(
    target_points: Iterable,
    source_points: Iterable,
    resolution: float = 0.08,
) -> dict:
    """Estimate car-map -> G1-map SE(2) from occupied-point geometry.

    ``target_points`` are the PCD's projected G1 XY obstacles and
    ``source_points`` are occupied cells from the car OccupancyGrid.
    The returned transform never contains scale; scale is only a diagnostic
    used to reject implausible feature matches.
    """
    target_xy = _xy_array(target_points)
    source_xy = _xy_array(source_points)
    extent = max(
        float(np.ptp(target_xy, axis=0).max()),
        float(np.ptp(source_xy, axis=0).max()),
    )
    shared_resolution = max(float(resolution), extent / 1600.0)
    target_raster = rasterize_point_map(target_xy, shared_resolution)
    source_raster = rasterize_point_map(source_xy, shared_resolution)
    points_target_px, points_source_px, _, _, matches = (
        find_image_correspondences(target_raster.image, source_raster.image)
    )

    pixel_affine, _ = cv2.estimateAffinePartial2D(
        points_source_px, points_target_px, method=cv2.LMEDS
    )
    if pixel_affine is None:
        raise ValueError("Transformarea vizuală nu a putut fi estimată")
    feature_scale = math.sqrt(abs(float(np.linalg.det(pixel_affine[:, :2]))))

    matched_target = pixels_to_world(points_target_px, target_raster)
    matched_source = pixels_to_world(points_source_px, source_raster)
    x, y, yaw, residuals = estimate_rigid_transform(
        matched_target, matched_source
    )
    rmse = float(math.sqrt(np.mean(np.square(residuals))))
    spread = float(np.linalg.norm(np.ptp(matched_source, axis=0)))
    overlap = _overlap_ratio(
        target_xy, source_xy, x, y, yaw, shared_resolution
    )
    match_count = len(matches)
    accepted = bool(
        match_count >= 4
        and 0.80 <= feature_scale <= 1.20
        and rmse <= max(0.40, shared_resolution * 5.0)
        and spread >= 0.75
        and overlap >= 0.10
    )
    confidence = min(1.0, match_count / 18.0) * min(1.0, overlap / 0.35)
    confidence *= max(0.0, 1.0 - rmse / 1.0)
    return {
        "accepted": accepted,
        "x": x,
        "y": y,
        "yaw": yaw,
        "yaw_deg": math.degrees(yaw),
        "matches": match_count,
        "rmse_m": rmse,
        "overlap": float(overlap),
        "feature_scale": float(feature_scale),
        "matched_spread_m": spread,
        "confidence": float(confidence),
        "resolution": float(shared_resolution),
        "target_points": int(target_xy.shape[0]),
        "source_points": int(source_xy.shape[0]),
    }


def scale_keypoints(keypoints: list, scale: float) -> list:
    """Scale keypoint positions and sizes for a resized image."""
    return [
        cv2.KeyPoint(
            point.pt[0] * scale,
            point.pt[1] * scale,
            point.size * scale,
            point.angle,
            point.response,
            point.octave,
            point.class_id,
        )
        for point in keypoints
    ]


def main() -> None:
    image_a = cv2.imread(IMAGE_A_PATH, cv2.IMREAD_GRAYSCALE)
    image_b = cv2.imread(IMAGE_B_PATH, cv2.IMREAD_GRAYSCALE)
    if image_a is None or image_b is None:
        raise FileNotFoundError("Could not load image A or image B")

    points_a, points_b, keypoints_a, keypoints_b, inlier_matches = (
        find_image_correspondences(image_a, image_b)
    )
    transform, _ = cv2.estimateAffinePartial2D(
        points_b, points_a, method=cv2.RANSAC, ransacReprojThreshold=3.0
    )
    image_b_aligned = cv2.warpAffine(
        image_b, transform, (image_a.shape[1], image_a.shape[0])
    )
    overlay = cv2.addWeighted(image_a, 0.5, image_b_aligned, 0.5, 0.0)
    print(f"Feature matches: {len(inlier_matches)}")
    print("Feature transform:\n", transform)
    scaled_image_a = cv2.resize(
        image_a, None, fx=DISPLAY_SCALE, fy=DISPLAY_SCALE,
        interpolation=cv2.INTER_NEAREST,
    )
    scaled_image_b = cv2.resize(
        image_b, None, fx=DISPLAY_SCALE, fy=DISPLAY_SCALE,
        interpolation=cv2.INTER_NEAREST,
    )
    match_view = cv2.drawMatches(
        scaled_image_b, scale_keypoints(keypoints_b, DISPLAY_SCALE),
        scaled_image_a, scale_keypoints(keypoints_a, DISPLAY_SCALE),
        inlier_matches, None,
        flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS,
    )
    scaled_overlay = cv2.resize(
        overlay, None, fx=DISPLAY_SCALE, fy=DISPLAY_SCALE,
        interpolation=cv2.INTER_NEAREST,
    )
    for window_name, image in {
        "Feature Matches": match_view,
        "Feature Overlay": scaled_overlay,
    }.items():
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.imshow(window_name, image)
        cv2.resizeWindow(window_name, image.shape[1], image.shape[0])
    print("Feature stitching finished. Press any key to close the images.")
    cv2.waitKey(0)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
