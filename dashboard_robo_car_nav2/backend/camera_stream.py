"""Receiver RealSense color/depth. Vizualizare separată de controlul G1 v3."""
import socket
import struct
import threading
import time

import cv2
import numpy as np

MAX_PACKET = 8 * 1024 * 1024


def decode_packet(payload):
    if len(payload) < 8:
        raise ValueError("Pachet cameră prea scurt")
    color_size, depth_size = struct.unpack(">II", payload[:8])
    if not color_size or not depth_size or 8 + color_size + depth_size != len(payload):
        raise ValueError("Lungimi color/depth invalide")
    color = payload[8:8 + color_size]
    color_image = cv2.imdecode(np.frombuffer(color, np.uint8), cv2.IMREAD_COLOR)
    depth = cv2.imdecode(np.frombuffer(payload[8 + color_size:], np.uint8), cv2.IMREAD_UNCHANGED)
    if color_image is None or depth is None or depth.ndim != 2:
        raise ValueError("Color/depth nu pot fi decodate")
    depth_display = cv2.applyColorMap(cv2.convertScaleAbs(depth, alpha=255 / 4000), cv2.COLORMAP_TURBO)
    depth_display[depth == 0] = 0
    ok, depth_jpeg = cv2.imencode('.jpg', depth_display)
    if not ok:
        raise ValueError("Nu pot codifica vizualizarea depth")
    return color, depth_jpeg.tobytes(), [int(depth.shape[1]), int(depth.shape[0])]


class CameraStream:
    def __init__(self):
        self.ready = threading.Event()
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.listener = self.connection = self.thread = None
        self.color = self.depth = None
        self.received_at = 0.0
        self.size = None
        self.error = ''

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stopping.clear()
        self.thread = threading.Thread(target=self._run, name='realsense-receiver', daemon=True)
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
                raise ConnectionError('Camera deconectată')
            data.extend(chunk)
        if len(data) != size:
            raise ConnectionError('Receiver închis')
        return bytes(data)

    def _run(self):
        try:
            with socket.socket() as listener:
                self.listener = listener
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(('127.0.0.1', 5005))
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
                                size, = struct.unpack('>I', self._read(conn, 4))
                                if size < 8 or size > MAX_PACKET:
                                    raise ValueError('Pachet cameră în afara limitei')
                                color, depth, dimensions = decode_packet(self._read(conn, size))
                                with self.lock:
                                    self.color, self.depth, self.size = color, depth, dimensions
                                    self.received_at, self.error = time.monotonic(), ''
                        except (OSError, ValueError) as exc:
                            self.error = str(exc)
        except OSError as exc:
            self.error = str(exc)
        finally:
            self.ready.clear()

    def status(self):
        with self.lock:
            age = time.monotonic() - self.received_at if self.received_at else None
            return {'ready': self.ready.is_set(), 'fresh': age is not None and age < 1,
                    'age': age, 'size': self.size, 'error': self.error}

    def frame(self, kind):
        with self.lock:
            return self.color if kind == 'color' else self.depth if kind == 'depth' else None


camera = CameraStream()
