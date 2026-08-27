#!/usr/bin/env python3

import cv2
import numpy as np
import subprocess

WINDOW = "G1 - Raw Camera"

WIDTH = 1280
HEIGHT = 720
FRAME_BYTES = WIDTH * HEIGHT * 3

cmd = [
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "error",

    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-probesize", "32",
    "-analyzeduration", "0",

    "-f", "mjpeg",
    "-i",
    "udp://127.0.0.1:5600?fifo_size=1024&overrun_nonfatal=1",

    "-an",
    "-pix_fmt", "bgr24",
    "-f", "rawvideo",
    "pipe:1",
]

proc = subprocess.Popen(
    cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    bufsize=FRAME_BYTES * 2,
)

if proc.stdout is None:
    raise RuntimeError("Could not open FFmpeg output.")

# Same window behavior as the keypoint viewer:
# - no OpenCV toolbar
# - no status bar
# - freely fills resized/tiled window
cv2.namedWindow(
    WINDOW,
    cv2.WINDOW_NORMAL
    | cv2.WINDOW_GUI_NORMAL
    | cv2.WINDOW_FREERATIO,
)

cv2.resizeWindow(WINDOW, 960, 540)

print("Connected to raw camera on UDP 5600")
print("Window is freely resizable.")
print("Press q to close.")

def read_exact(n):
    chunks = []
    remaining = n

    while remaining > 0:
        chunk = proc.stdout.read(remaining)

        if not chunk:
            return None

        chunks.append(chunk)
        remaining -= len(chunk)

    return b"".join(chunks)

try:
    while True:
        raw = read_exact(FRAME_BYTES)

        if raw is None:
            break

        frame = np.frombuffer(
            raw,
            dtype=np.uint8,
        ).reshape(
            HEIGHT,
            WIDTH,
            3,
        )

        cv2.imshow(WINDOW, frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

finally:
    cv2.destroyAllWindows()

    if proc.poll() is None:
        proc.terminate()

    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
