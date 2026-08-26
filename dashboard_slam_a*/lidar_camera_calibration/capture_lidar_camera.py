#!/usr/bin/env python3
"""Capture stationary ChArUco RGB/depth + fresh Mid-360 calibration samples.

Space (or C) freezes the current camera frame, then the recorder waits for the
requested number of *new* PointCloud2 messages. Q/Escape exits. In headless
mode, press Enter to capture and type q + Enter to exit.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import select
import sys
import threading
import time
from typing import Any

import cv2
import numpy as np

from common import BoardSpec, detect_charuco, pointcloud2_xyz, voxel_downsample, write_json
from web_preview import BrowserPreview


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "data")
    parser.add_argument("--topic", default="/utlidar/cloud_livox_mid360")
    parser.add_argument("--lidar-frames", type=int, choices=(3, 4, 5), default=5)
    parser.add_argument("--voxel-size", type=float, default=0.005,
                        help="Per-frame LiDAR voxel size in metres; 0 preserves every point")
    parser.add_argument("--min-charuco-corners", type=int, default=8)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--headless", action="store_true",
                        help="Use Enter in the terminal instead of an OpenCV window")
    parser.add_argument("--web-preview", action="store_true",
                        help="Serve the preview and keyboard controls in a browser")
    parser.add_argument("--web-port", type=int, default=8765)
    return parser.parse_args()


class PendingCapture:
    def __init__(self, camera: dict[str, Any], color: np.ndarray, depth: np.ndarray,
                 corners: np.ndarray, corner_ids: np.ndarray, count: int):
        self.camera = camera
        self.color = color.copy()
        self.depth = depth.copy()
        self.corners = corners.copy()
        self.corner_ids = corner_ids.copy()
        self.target_count = count
        self.clouds: list[np.ndarray] = []
        self.cloud_metadata: list[dict[str, Any]] = []

    @property
    def complete(self) -> bool:
        return len(self.clouds) >= self.target_count


class CloudCollector:
    def __init__(self, node, message_type, topic: str, qos, voxel_size: float):
        self._lock = threading.Lock()
        self._pending: PendingCapture | None = None
        self._voxel_size = voxel_size
        self.last_cloud_at = 0.0
        self.decode_error: str | None = None
        self.subscription = node.create_subscription(message_type, topic, self._callback, qos)

    def arm(self, pending: PendingCapture) -> bool:
        with self._lock:
            if self._pending is not None:
                return False
            self._pending = pending
            return True

    def progress(self) -> tuple[int, int]:
        with self._lock:
            if self._pending is None:
                return 0, 0
            return len(self._pending.clouds), self._pending.target_count

    def take_complete(self) -> PendingCapture | None:
        with self._lock:
            if self._pending is None or not self._pending.complete:
                return None
            result = self._pending
            self._pending = None
            return result

    def _callback(self, message) -> None:
        self.last_cloud_at = time.monotonic()
        with self._lock:
            pending = self._pending
            if pending is None or pending.complete:
                return
        try:
            points = voxel_downsample(pointcloud2_xyz(message), self._voxel_size)
        except Exception as exc:
            self.decode_error = str(exc)
            return
        stamp = message.header.stamp
        metadata = {
            "stamp_sec": int(stamp.sec),
            "stamp_nanosec": int(stamp.nanosec),
            "frame_id": str(message.header.frame_id),
            "point_count": int(len(points)),
        }
        with self._lock:
            if self._pending is pending and not pending.complete:
                pending.clouds.append(points)
                pending.cloud_metadata.append(metadata)


def _next_sample_dir(root: Path) -> Path:
    existing = []
    for path in root.glob("pose_*"):
        try:
            existing.append(int(path.name.split("_", 1)[1]))
        except (IndexError, ValueError):
            pass
    return root / f"pose_{max(existing, default=0) + 1:03d}"


def _save_capture(root: Path, pending: PendingCapture, board: BoardSpec) -> Path:
    sample_dir = _next_sample_dir(root)
    sample_dir.mkdir(parents=False, exist_ok=False)
    if not cv2.imwrite(str(sample_dir / "color.png"), pending.color):
        raise OSError("Could not save color.png")
    if not cv2.imwrite(str(sample_dir / "depth_mm.png"), pending.depth):
        raise OSError("Could not save depth_mm.png")
    offsets = [0]
    for cloud in pending.clouds:
        offsets.append(offsets[-1] + len(cloud))
    merged = np.concatenate(pending.clouds, axis=0).astype(np.float32, copy=False)
    np.savez_compressed(
        sample_dir / "lidar_frames.npz",
        points=merged,
        frame_offsets=np.asarray(offsets, dtype=np.int64),
    )
    metadata = {
        "board": board.to_dict(),
        "camera": pending.camera,
        "charuco": {
            "corner_count": int(len(pending.corner_ids)),
            "corner_ids": pending.corner_ids.tolist(),
            "corners_px": pending.corners.tolist(),
        },
        "lidar": {
            "message_count": len(pending.clouds),
            "messages": pending.cloud_metadata,
        },
    }
    write_json(sample_dir / "metadata.json", metadata)
    manifest_path = root / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {"format_version": 1, "samples": []}
    manifest["samples"].append(sample_dir.name)
    write_json(manifest_path, manifest)
    return sample_dir


def _camera_metadata(color_frame, intrinsics, distortion_model: str, depth_scale: float) -> dict[str, Any]:
    return {
        "frame_number": int(color_frame.get_frame_number()),
        "realsense_timestamp_ms": float(color_frame.get_timestamp()),
        "captured_unix_ns": time.time_ns(),
        "width": int(intrinsics.width),
        "height": int(intrinsics.height),
        "fx": float(intrinsics.fx),
        "fy": float(intrinsics.fy),
        "cx": float(intrinsics.ppx),
        "cy": float(intrinsics.ppy),
        "distortion_model": distortion_model,
        "distortion": [float(value) for value in intrinsics.coeffs],
        "depth_scale_m": float(depth_scale),
        "depth_aligned_to_color": True,
    }


def main() -> int:
    args = parse_args()
    if args.min_charuco_corners < 4 or args.min_charuco_corners > 15:
        raise SystemExit("--min-charuco-corners must be between 4 and 15 for this board")
    try:
        import pyrealsense2 as rs
        import rclpy
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import qos_profile_sensor_data
        from sensor_msgs.msg import PointCloud2
    except ImportError as exc:
        raise SystemExit(
            f"Missing robot dependency: {exc}. Source ROS 2 and activate the environment "
            "that contains pyrealsense2."
        ) from exc

    args.output.mkdir(parents=True, exist_ok=True)
    board = BoardSpec()
    write_json(args.output / "board.json", board.to_dict())

    lock_file = open("/tmp/unitree_send_video_depth.lock", "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise SystemExit(
            "RealSense is already owned by send_video_depth.py. Stop the dashboard/camera "
            "sender before running calibration capture."
        ) from exc

    rclpy.init()
    node = rclpy.create_node("g1_lidar_camera_calibration_capture")
    collector = CloudCollector(
        node, PointCloud2, args.topic, qos_profile_sensor_data, args.voxel_size
    )
    executor = SingleThreadedExecutor()
    executor.add_node(node)
    spin_thread = threading.Thread(target=executor.spin, name="calibration-lidar", daemon=True)
    spin_thread.start()

    pipeline = rs.pipeline()
    config = rs.config()
    config.enable_stream(rs.stream.depth, args.width, args.height, rs.format.z16, args.fps)
    config.enable_stream(rs.stream.color, args.width, args.height, rs.format.bgr8, args.fps)
    profile = None
    browser = None
    try:
        profile = pipeline.start(config)
        color_profile = profile.get_stream(rs.stream.color).as_video_stream_profile()
        intrinsics = color_profile.get_intrinsics()
        distortion_model = str(intrinsics.model).split(".")[-1]
        depth_scale = profile.get_device().first_depth_sensor().get_depth_scale()
        align = rs.align(rs.stream.color)
        print(f"Dataset: {args.output}")
        print(f"LiDAR: {args.topic}; {args.lidar_frames} fresh messages per key press")
        publisher_count = len(node.get_publishers_info_by_topic(args.topic))
        print(f"ROS discovery: {publisher_count} publisher(s) on {args.topic}")
        if publisher_count == 0:
            print("WARNING: no LiDAR publisher discovered. Check CYCLONEDDS_URI and the driver.")
        use_browser = args.web_preview or not os.environ.get("DISPLAY")
        if use_browser:
            browser = BrowserPreview(args.web_port, capture_enabled=True)
            print(f"Browser preview: http://ROBOT_IP:{args.web_port}")
            print("SPACE/C in browser (or Enter here) = capture; Q = quit")
        else:
            print("SPACE/C = capture, Q/Escape = quit")
        last_status = 0.0
        while True:
            frames = align.process(pipeline.wait_for_frames(5000))
            color_frame = frames.get_color_frame()
            depth_frame = frames.get_depth_frame()
            if not color_frame or not depth_frame:
                continue
            color = np.asanyarray(color_frame.get_data())
            depth_raw = np.asanyarray(depth_frame.get_data())
            depth_mm = np.clip(
                depth_raw.astype(np.float32) * depth_scale * 1000.0, 0, 65535
            ).astype(np.uint16)
            corners, corner_ids, display = detect_charuco(color, board)
            current, target = collector.progress()
            cloud_age = time.monotonic() - collector.last_cloud_at if collector.last_cloud_at else float("inf")
            status = (f"ChArUco {len(corner_ids)}/15 | "
                      + (f"CAPTURING LiDAR {current}/{target}" if target else
                         f"LiDAR age {cloud_age:.1f}s | SPACE/C capture"))
            color_value = (0, 220, 0) if len(corner_ids) >= args.min_charuco_corners else (0, 0, 255)
            cv2.putText(display, status, (10, 26), cv2.FONT_HERSHEY_SIMPLEX,
                        0.58, color_value, 2, cv2.LINE_AA)

            completed = collector.take_complete()
            if completed is not None:
                saved = _save_capture(args.output, completed, board)
                print(f"Saved {saved.name}: 1 RGB/depth pair + {len(completed.clouds)} LiDAR frames")

            capture_requested = False
            quit_requested = False
            if browser is not None:
                browser.update(display, status)
                capture_requested = browser.take_capture_request()
                quit_requested = browser.quit_requested.is_set()
            if args.headless or browser is not None:
                if select.select([sys.stdin], [], [], 0.0)[0]:
                    command = sys.stdin.readline().strip().lower()
                    terminal_quit = command == "q"
                    quit_requested = quit_requested or terminal_quit
                    capture_requested = capture_requested or not terminal_quit
                if time.monotonic() - last_status > 1.0:
                    print(f"\r{status:80s}", end="", flush=True)
                    last_status = time.monotonic()
            else:
                try:
                    cv2.imshow("G1 LiDAR-camera calibration", display)
                    key = cv2.waitKey(1) & 0xFF
                    quit_requested = key in (27, ord("q"))
                    capture_requested = key in (ord(" "), ord("c"))
                except cv2.error:
                    browser = BrowserPreview(args.web_port, capture_enabled=True)
                    print(f"GTK unavailable; browser preview: http://ROBOT_IP:{args.web_port}")
            if quit_requested:
                break
            if capture_requested:
                if target:
                    print("A capture is already collecting LiDAR frames.")
                elif len(corner_ids) < args.min_charuco_corners:
                    print(f"Rejected: only {len(corner_ids)} ChArUco corners; need "
                          f"{args.min_charuco_corners}.")
                elif cloud_age > 1.0:
                    print(f"Rejected: no fresh LiDAR stream on {args.topic}.")
                else:
                    pending = PendingCapture(
                        _camera_metadata(color_frame, intrinsics, distortion_model, depth_scale),
                        color,
                        depth_mm,
                        corners,
                        corner_ids,
                        args.lidar_frames,
                    )
                    collector.arm(pending)
                    print(f"Camera frozen; collecting {args.lidar_frames} new LiDAR frames...")
    except KeyboardInterrupt:
        pass
    finally:
        if profile is not None:
            pipeline.stop()
        if browser is not None:
            browser.close()
        cv2.destroyAllWindows()
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        spin_thread.join(timeout=2.0)
        lock_file.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

