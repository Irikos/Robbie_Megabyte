"""Tiny dependency-free browser preview for headless robot sessions."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from typing import Any
from urllib.parse import urlparse

import cv2


_PAGE = b"""<!doctype html><html><head><meta charset="utf-8">
<title>G1 calibration</title><style>
body{margin:0;background:#111;color:#eee;font:16px sans-serif;text-align:center}
h2{margin:12px}.frame{max-width:96vw;max-height:78vh;border:1px solid #555}
button{font-size:18px;margin:10px;padding:10px 22px}#status{margin:8px}
</style></head><body><h2>G1 LiDAR-camera calibration</h2>
<img class="frame" id="frame"><div id="status">Waiting for camera...</div>
<button id="capture">Capture (Space / C)</button><button id="quit">Stop (Q)</button>
<script>
const frame=document.getElementById('frame'),statusEl=document.getElementById('status');
function refresh(){const next=new Image();next.onload=()=>frame.src=next.src;
next.src='/frame.jpg?t='+Date.now();fetch('/status.json').then(r=>r.json()).then(x=>statusEl.textContent=x.status).catch(()=>{});}
setInterval(refresh,150);refresh();function post(path){fetch(path,{method:'POST'});}
document.getElementById('capture').onclick=()=>post('/capture');
document.getElementById('quit').onclick=()=>post('/quit');
document.addEventListener('keydown',e=>{if(e.code==='Space'||e.key.toLowerCase()==='c'){e.preventDefault();post('/capture');}
else if(e.key.toLowerCase()==='q'||e.key==='Escape')post('/quit');});
</script></body></html>"""


class BrowserPreview:
    def __init__(self, port: int = 8765, capture_enabled: bool = True):
        self._lock = threading.Lock()
        self._jpeg: bytes | None = None
        self._status = "Waiting for camera..."
        self.capture_requested = threading.Event()
        self.quit_requested = threading.Event()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def send_body(self, status: int, content_type: str, body: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                if path == "/":
                    page = _PAGE
                    if not capture_enabled:
                        page = page.replace(
                            b'<button id="capture">Capture (Space / C)</button>', b""
                        ).replace(
                            b"document.getElementById('capture').onclick=()=>post('/capture');", b""
                        )
                    self.send_body(200, "text/html; charset=utf-8", page)
                elif path == "/frame.jpg":
                    with owner._lock:
                        jpeg = owner._jpeg
                    self.send_body(200 if jpeg else 503, "image/jpeg", jpeg or b"")
                elif path == "/status.json":
                    with owner._lock:
                        body = json.dumps({"status": owner._status}).encode()
                    self.send_body(200, "application/json", body)
                else:
                    self.send_body(404, "text/plain", b"not found")

            def do_POST(self) -> None:
                path = urlparse(self.path).path
                if path == "/capture" and capture_enabled:
                    owner.capture_requested.set()
                    self.send_body(204, "text/plain", b"")
                elif path == "/quit":
                    owner.quit_requested.set()
                    self.send_body(204, "text/plain", b"")
                else:
                    self.send_body(404, "text/plain", b"not found")

        self._server = ThreadingHTTPServer(("0.0.0.0", int(port)), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="calibration-web-preview", daemon=True
        )
        self._thread.start()

    def update(self, image, status: str) -> None:
        ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if ok:
            with self._lock:
                self._jpeg = encoded.tobytes()
                self._status = status

    def take_capture_request(self) -> bool:
        requested = self.capture_requested.is_set()
        self.capture_requested.clear()
        return requested

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2.0)
