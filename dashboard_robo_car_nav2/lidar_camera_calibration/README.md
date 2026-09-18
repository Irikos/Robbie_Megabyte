# G1 Mid-360 to RealSense calibration

This tool estimates the rigid transform
`livox_frame -> camera_color_optical_frame`. It uses the 6 x 4 ChArUco
board (`60 mm` squares, `42 mm` markers, `DICT_5X5_100`) as a camera-visible
plane and a larger rigid backing board as the LiDAR-visible plane.

This directory is a standalone tool: it does not import or start the dashboard, frontend, backend, or Nav2. Copy the whole directory to `/home/unitree/lidar_camera_calibration` on the robot.
## Target and scene

- Verify the printed 100 mm reference line and a 60 mm square.
- Fix the print flat to a matte, rigid board at least 600 x 450 mm.
- Place the board 0.8-1.3 m away and at least 0.5 m in front of any wall.
- Clamp the board and keep the G1 stationary for each capture.
- Collect 15-20 poses spanning left/right/up/down, multiple distances, and
  approximately +/-15-40 degrees of yaw and pitch.

## Capture on the G1

Stop the dashboard camera sender first; only one process can own the RealSense.
Then open a terminal with a graphical display and run:

```bash
cd /home/unitree/lidar_camera_calibration
source /opt/ros/humble/setup.bash
source /home/unitree/Livox-SDK2/ws_livox/install/setup.bash

python3 capture_lidar_camera.py \
  --output /home/unitree/lidar_camera_calibration/data \
  --lidar-frames 5
```

The preview must show at least 8 ChArUco corners and a fresh LiDAR stream.
Press **Space** or **C** once. The program freezes that lossless camera/depth
pair and automatically records the next five distinct Mid-360 messages. Wait
for `Saved pose_NNN` before moving the board. Press **Q** or Escape to finish.

Three or four cloud messages can be selected with `--lidar-frames 3` or `4`.
Five is recommended for this small target. If a graphical window is not
possible, `--headless` uses Enter to capture, but a graphical preview is much
safer because glare and partial detections are immediately visible.

Each pose contains:

```text
pose_NNN/
  color.png                 raw, unmirrored color frame
  depth_mm.png              depth aligned to color
  lidar_frames.npz          3-5 fresh LiDAR messages and frame boundaries
  metadata.json             timestamps, intrinsics, detections, frame IDs
```

## Solve the extrinsic

Run from a graphical terminal after at least eight captures (15-20 preferred):

```bash
python3 solve_lidar_camera.py \
  /home/unitree/lidar_camera_calibration/data
```

For each pose, a spherical Mid-360 range image opens. Draw a tight rectangle
around the physical backing board, press Enter, inspect the green plane
inliers, and answer `y` only when they cover the board rather than a wall or
floor. Accepted selections are cached in `lidar_plane.json`; use `--reselect`
to redo them.

The solver produces:

- `lidar_to_camera.yaml`: transform using `x_camera = R*x_lidar + t`;
- `calibration_diagnostics.json`: per-pose normal/distance residuals;
- `pose_NNN/projection_validation.png`: LiDAR projected over the RGB image.

Do not deploy the transform until all validation overlays align with target,
door, wall, and furniture edges. Prefer normal RMS below 1 degree and plane
distance RMS below 20 mm; recapture outliers or add more strongly tilted poses
when translation conditioning is weak.

