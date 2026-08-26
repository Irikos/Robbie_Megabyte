#!/usr/bin/env python3
"""Display raw RealSense color and aligned depth without ROS or dashboard."""

import fcntl
import os
import sys

import cv2
import numpy as np
from web_preview import BrowserPreview

try:
    import pyrealsense2 as rs
except ImportError as exc:
    raise SystemExit(f"pyrealsense2 is not available to {sys.executable}: {exc}") from exc


def main() -> int:
    lock_file = open("/tmp/unitree_send_video_depth.lock", "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise SystemExit(
            "RealSense is already used by send_video_depth.py or calibration capture. "
            "Stop that process first."
        ) from exc

    pipeline = rs.pipeline()
    config = rs.config()
    config.enable_stream(rs.stream.depth, 640, 480, rs.format.z16, 30)
    config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
    profile = None
    browser = None
    try:
        profile = pipeline.start(config)
        align = rs.align(rs.stream.color)
        if not os.environ.get("DISPLAY"):
            browser = BrowserPreview(8765, capture_enabled=False)
            print("Camera preview: http://ROBOT_IP:8765")
        else:
            print("Camera preview active. Press Q or Escape in the window to exit.")
        while True:
            frames = align.process(pipeline.wait_for_frames(5000))
            color_frame = frames.get_color_frame()
            depth_frame = frames.get_depth_frame()
            if not color_frame or not depth_frame:
                continue
            color = np.asanyarray(color_frame.get_data())
            depth = np.asanyarray(depth_frame.get_data())
            depth_display = cv2.applyColorMap(
                cv2.convertScaleAbs(depth, alpha=0.04), cv2.COLORMAP_TURBO
            )
            combined = np.hstack((color, depth_display))
            cv2.putText(combined, "RGB", (12, 28), cv2.FONT_HERSHEY_SIMPLEX,
                        0.75, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(combined, "Aligned depth", (652, 28), cv2.FONT_HERSHEY_SIMPLEX,
                        0.75, (255, 255, 255), 2, cv2.LINE_AA)
            if browser is not None:
                browser.update(combined, "Raw RGB (left) | aligned depth (right)")
                if browser.quit_requested.is_set():
                    break
            else:
                try:
                    cv2.imshow("G1 RealSense preview", combined)
                    if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                        break
                except cv2.error:
                    browser = BrowserPreview(8765, capture_enabled=False)
                    print("GTK unavailable; camera preview: http://ROBOT_IP:8765")
    except KeyboardInterrupt:
        pass
    finally:
        if profile is not None:
            pipeline.stop()
        if browser is not None:
            browser.close()
        cv2.destroyAllWindows()
        lock_file.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
