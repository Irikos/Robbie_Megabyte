"""PCD file I/O. Does not initialize ROS or change robot configuration."""
import math
import os
import struct
from pathlib import Path


def pcd_header(count: int) -> str:
    return (
        "# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\n"
        "SIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
        f"WIDTH {count}\nHEIGHT 1\nPOINTS {count}\nDATA ascii\n"
    )


def write_pcd_atomic(path: Path, points: list[tuple[float, float, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="ascii") as stream:
        stream.write(pcd_header(len(points)))
        for x, y, z in points:
            stream.write(f"{x:.4f} {y:.4f} {z:.4f}\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def read_pcd(path: Path) -> list[tuple[float, float, float]]:
    """Citeste PCD ASCII sau binary cu campuri x/y/z de tip float32."""
    raw = path.read_bytes()
    marker = raw.find(b"DATA ")
    if marker < 0:
        raise ValueError("Fisier PCD fara sectiune DATA")
    header_end = raw.find(b"\n", marker)
    if header_end < 0:
        raise ValueError("Antet PCD incomplet")
    header = raw[: header_end + 1].decode("ascii", errors="replace")
    body = raw[header_end + 1 :]
    metadata: dict[str, list[str]] = {}
    data_kind = ""
    for line in header.splitlines():
        parts = line.strip().split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0].upper() == "DATA":
            data_kind = parts[1].lower()
        else:
            metadata[parts[0].upper()] = parts[1:]
    fields = metadata.get("FIELDS", [])
    if not all(axis in fields for axis in ("x", "y", "z")):
        raise ValueError("PCD fara campurile x/y/z")
    result: list[tuple[float, float, float]] = []
    if data_kind == "ascii":
        indices = [fields.index(axis) for axis in ("x", "y", "z")]
        for line in body.decode("ascii", errors="ignore").splitlines():
            values = line.split()
            try:
                point = tuple(float(values[index]) for index in indices)
            except (IndexError, ValueError):
                continue
            if all(math.isfinite(v) for v in point):
                result.append(point)
        return result
    if data_kind != "binary":
        raise ValueError(f"Format PCD nesuportat: {data_kind}")
    sizes = [int(v) for v in metadata.get("SIZE", [])]
    types = metadata.get("TYPE", [])
    counts = [int(v) for v in metadata.get("COUNT", ["1"] * len(fields))]
    if not (len(fields) == len(sizes) == len(types) == len(counts)):
        raise ValueError("Descriere PCD binary invalida")
    offsets: dict[str, int] = {}
    point_step = 0
    for field, size, count in zip(fields, sizes, counts):
        offsets[field] = point_step
        point_step += size * count
    if any(types[fields.index(axis)].upper() != "F" or sizes[fields.index(axis)] != 4 for axis in ("x", "y", "z")):
        raise ValueError("PCD binary x/y/z trebuie sa fie float32")
    declared = int((metadata.get("POINTS") or metadata.get("WIDTH") or ["0"])[0])
    available = len(body) // point_step
    for index in range(min(declared or available, available)):
        base = index * point_step
        point = tuple(struct.unpack_from("<f", body, base + offsets[axis])[0] for axis in ("x", "y", "z"))
        if all(math.isfinite(v) for v in point):
            result.append(point)
    return result
