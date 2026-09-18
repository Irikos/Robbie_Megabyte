# Offline XYZRGB validation

After generating `data/lidar_to_camera.yaml`, colorize one stationary capture:

```bash
python3 colorize_capture.py ./data pose_001
```

The tool uses the raw, unmirrored RGB image and the calibrated mapping
`x_camera = R*x_lidar + t`. It rejects points outside the image and points
whose camera Z disagrees with aligned RealSense depth, then averages repeated
observations into 1 cm voxels.

Outputs are written below the selected pose:

```text
colorized/cloud_xyzrgb.pcd
colorized/cloud_xyzrgb.ply
colorized/projection_overlay.png
colorized/colorization_stats.json
```

XYZ remains in `livox_frame`. Open the PLY in CloudCompare or MeshLab. Inspect
`projection_overlay.png` to confirm that projected returns follow physical
edges. Use `--voxel-size 0.005` for denser output or `--voxel-size 0` to keep
every accepted observation.

