# Camera Pose Teleop

Camera-based whole-body human pose estimation and teleoperation pipeline.

Current validated development path:

Camera
-> YOLOX + ByteTrack
-> ViTPose-H
-> HMR2 visual features
-> GVHMR
-> Pair FASTIK
-> SONIC Protocol V3
-> MuJoCo / Unitree G1

The currently validated reference camera is an Intel RealSense D435i,
but the project is being structured to support configurable camera inputs.

The physical G1 deployment is still under validation.

## Calibration

Two calibration paths are kept separate:

- `calibration/legacy_fixed/`
  Known-good fixed-camera calibration used by the current working system.

- `calibration/auto_alignment/neutral_pose/`
  Development path for automatic camera alignment from a short neutral human pose.

Do not overwrite or remove the fixed-calibration baseline while developing
automatic alignment.
