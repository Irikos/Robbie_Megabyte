import numpy as np

from colorize_capture import fuse_colored_voxels, load_extrinsic


def test_color_voxels_average_geometry_and_rgb():
    points = np.array([[0.001, 0, 1], [0.009, 0, 1], [0.021, 0, 1]], dtype=float)
    colors = np.array([[100, 20, 0], [200, 40, 20], [10, 30, 50]], dtype=np.uint8)
    fused_points, fused_colors, counts = fuse_colored_voxels(points, colors, 0.01)
    assert counts.tolist() == [2, 1]
    assert np.allclose(fused_points[:, 0], [0.005, 0.021])
    assert fused_colors.tolist() == [[150, 30, 10], [10, 30, 50]]


def test_load_extrinsic_reads_solver_yaml(tmp_path):
    path = tmp_path / "transform.yaml"
    path.write_text(
        "translation_m: [0.1, -0.2, 0.3]\n"
        "rotation_matrix:\n"
        "  - [1, 0, 0]\n  - [0, 1, 0]\n  - [0, 0, 1]\n",
        encoding="utf-8",
    )
    rotation, translation = load_extrinsic(path)
    assert np.allclose(rotation, np.eye(3))
    assert np.allclose(translation, [0.1, -0.2, 0.3])
