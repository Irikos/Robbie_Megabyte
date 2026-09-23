"""Receiver RealSense color/depth + YOLO opțional. Vizualizare separată de controlul G1 v4."""
import os
import socket
import struct
import threading
import time
from pathlib import Path

import cv2
import numpy as np

try:
    from ultralytics import YOLO as _YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False

MAX_PACKET = 8 * 1024 * 1024
YOLO_MODEL_SIZE = "yolov8s"
YOLO_CONFIDENCE = 0.20
YOLO_MODEL_PATH = Path(os.environ.get("G1_YOLO_MODEL", "/home/unitree/yolov8s.pt")).expanduser()
_YOLO_PALETTE = [
    (0, 220, 255), (255, 80, 0), (0, 255, 100), (200, 0, 255),
    (255, 200, 0), (0, 150, 255), (255, 0, 150), (0, 255, 220),
]


def decode_packet(payload):
    if len(payload) < 8:
        raise ValueError("Pachet cameră prea scurt")
    color_size, depth_size = struct.unpack(">II", payload[:8])
    if not color_size or not depth_size or 8 + color_size + depth_size != len(payload):
        raise ValueError("Lungimi color/depth invalide")
    color = payload[8:8 + color_size]
    color_image = cv2.imdecode(np.frombuffer(color, np.uint8), cv2.IMREAD_COLOR)
    depth_raw = cv2.imdecode(np.frombuffer(payload[8 + color_size:], np.uint8), cv2.IMREAD_UNCHANGED)
    if color_image is None or depth_raw is None or depth_raw.ndim != 2:
        raise ValueError("Color/depth nu pot fi decodate")
    depth_display = cv2.applyColorMap(cv2.convertScaleAbs(depth_raw, alpha=255 / 4000), cv2.COLORMAP_TURBO)
    depth_display[depth_raw == 0] = 0
    ok, depth_jpeg = cv2.imencode(".jpg", depth_display)
    if not ok:
        raise ValueError("Nu pot codifica vizualizarea depth")
    return color, color_image, depth_raw, depth_jpeg.tobytes(), [int(depth_raw.shape[1]), int(depth_raw.shape[0])]


class CameraStream:
    def __init__(self):
        self.ready = threading.Event()
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.listener = self.connection = self.thread = None
        self.color = self.depth = None
        self.color_image = None  # numpy BGR decodat, doar pentru YOLO/semantic
        self.depth_raw = None    # numpy uint16 metric, doar pentru semantic mapping
        self.received_at = 0.0
        self.size = None
        self.error = ""
        self._yolo_error = ""
        self._yolo_lock = threading.Lock()
        self._yolo_model = None
        self._yolo_enabled = False
        self.yolo_detections = []

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stopping.clear()
        self.thread = threading.Thread(target=self._run, name="realsense-receiver", daemon=True)
        self.thread.start()

    def stop(self):
        self.stopping.set()
        self.ready.clear()
        for sock in (self.connection, self.listener):
            if sock:
                try:
                    sock.close()
                except OSError:
                    pass
        if self.thread:
            self.thread.join(timeout=2)

    def _read(self, conn, size):
        data = bytearray()
        while len(data) < size and not self.stopping.is_set():
            chunk = conn.recv(size - len(data))
            if not chunk:
                raise ConnectionError("Camera deconectată")
            data.extend(chunk)
        if len(data) != size:
            raise ConnectionError("Receiver închis")
        return bytes(data)

    def _run(self):
        try:
            with socket.socket() as listener:
                self.listener = listener
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", 5005))
                listener.listen(1)
                listener.settimeout(.5)
                self.ready.set()
                while not self.stopping.is_set():
                    try:
                        conn, _ = listener.accept()
                    except socket.timeout:
                        continue
                    with conn:
                        self.connection = conn
                        conn.settimeout(2)
                        try:
                            while not self.stopping.is_set():
                                size, = struct.unpack(">I", self._read(conn, 4))
                                if size < 8 or size > MAX_PACKET:
                                    raise ValueError("Pachet cameră în afara limitei")
                                color, color_image, depth_raw, depth, dimensions = decode_packet(
                                    self._read(conn, size)
                                )
                                annotated_color, detections = color, []
                                if self._yolo_enabled:
                                    annotated_bytes, detections = self._run_yolo(color_image)
                                    if annotated_bytes is not None:
                                        annotated_color = annotated_bytes
                                with self.lock:
                                    self.color = annotated_color
                                    self.color_image = color_image
                                    self.depth = depth
                                    self.depth_raw = depth_raw
                                    self.size = dimensions
                                    self.yolo_detections = detections
                                    self.received_at, self.error = time.monotonic(), ""
                        except (OSError, ValueError) as exc:
                            self.error = str(exc)
        except OSError as exc:
            self.error = str(exc)
        finally:
            self.ready.clear()

    def status(self):
        with self.lock:
            age = time.monotonic() - self.received_at if self.received_at else None
            return {
                "ready": self.ready.is_set(), "fresh": age is not None and age < 1,
                "age": age, "size": self.size, "error": self._yolo_error or self.error,
                "yolo_available": YOLO_AVAILABLE, "yolo_enabled": self._yolo_enabled,
                "yolo_model": YOLO_MODEL_SIZE, "yolo_model_loaded": self._yolo_model is not None,
                "yolo_model_path": str(YOLO_MODEL_PATH),
                "yolo_detections": list(self.yolo_detections),
            }

    def frame(self, kind):
        with self.lock:
            return self.color if kind == "color" else self.depth if kind == "depth" else None

    def raw_frames(self):
        """(color_image BGR numpy, depth_raw uint16 numpy) — pentru harta semantică; pot fi None."""
        with self.lock:
            return self.color_image, self.depth_raw

    def semantic_frame(self):
        """Cadru coerent color/depth/detecții pentru workerul semantic."""
        with self.lock:
            return (
                self.color_image, self.depth_raw,
                list(self.yolo_detections), self.received_at,
            )

    def set_yolo_enabled(self, enabled: bool) -> bool:
        self._yolo_enabled = bool(enabled) and YOLO_AVAILABLE
        if not self._yolo_enabled:
            with self.lock:
                self.yolo_detections = []
        return self._yolo_enabled

    def yolo_enabled(self) -> bool:
        return self._yolo_enabled

    def _get_yolo_model(self):
        if not YOLO_AVAILABLE:
            return None
        with self._yolo_lock:
            if self._yolo_model is None:
                try:
                    if not YOLO_MODEL_PATH.is_file():
                        raise FileNotFoundError(f"modelul local lipsește: {YOLO_MODEL_PATH}")
                    self._yolo_model = _YOLO(str(YOLO_MODEL_PATH))
                    self._yolo_error = ""
                except Exception as exc:
                    self._yolo_error = f"YOLO: {exc}"
                    return None
        return self._yolo_model

    def _run_yolo(self, color_image):
        """Rulează detecția pe cadrul curent; întoarce (jpeg_adnotat_bytes|None, detections)."""
        model = self._get_yolo_model()
        if model is None or color_image is None:
            return None, []
        try:
            result = model(color_image, verbose=False, conf=YOLO_CONFIDENCE, imgsz=640)[0]
        except Exception as exc:
            self._yolo_error = f"YOLO inferență: {exc}"
            return None, []
        names = result.names
        annotated = color_image.copy()
        detections = []
        for box in result.boxes:
            cls_id = int(box.cls[0])
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            label = names.get(cls_id, str(cls_id))
            box_color = _YOLO_PALETTE[cls_id % len(_YOLO_PALETTE)]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), box_color, 2)
            text = f"{label} {confidence:.2f}"
            (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, max(0, y1 - text_h - 6)), (x1 + text_w + 4, y1), box_color, -1)
            cv2.putText(
                annotated, text, (x1 + 2, y1 - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA,
            )
            detections.append({
                "label": label, "confidence": round(confidence, 3),
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            })
        ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            return None, detections
        return encoded.tobytes(), detections


camera = CameraStream()
