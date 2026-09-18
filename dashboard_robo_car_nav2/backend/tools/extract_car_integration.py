"""One-off mechanical extraction from the preserved pre-transpose backend.

No imports/execution of the old backend or robot SDK; writes via apply_patch.
"""
import ast
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'backups/pre_v3_nkgPwP/backend/server.py'
source = SOURCE.read_text()
lines = source.splitlines(keepends=True)
tree = ast.parse(source)
globals_to_keep = {
    'active_ws', 'car_ws', 'car_transform', 'car_alignment', 'car_auto_align_task',
    'car_alignment_projection_cache', 'car_alignment_projection_lock', 'car_state',
}
functions = {
    'broadcast', '_normalize_yaw', '_yaw_from_quaternion', '_yaw_quaternion',
    '_compute_car_map_alignment', '_run_car_auto_alignment',
    'car_websocket_endpoint', 'get_car_status', 'set_car_transform',
    'auto_align_car_maps', 'send_car_goal', 'set_car_initial_pose', 'set_car_mode',
    'get_car_mode', 'get_car_maps', 'refresh_car_maps', 'save_car_map_endpoint',
    'preview_car_path',
}
pieces = []
for node in tree.body:
    names = set()
    if isinstance(node, ast.Assign):
        names = {target.id for target in node.targets if isinstance(target, ast.Name)}
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        names = {node.target.id}
    keep = bool(names & globals_to_keep)
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        keep = node.name in functions or node.name.startswith('_car_') or node.name == '_refresh_car_spatial_layers'
    if keep:
        start = min([node.lineno] + [d.lineno for d in getattr(node, 'decorator_list', [])])
        pieces.append(''.join(lines[start - 1:node.end_lineno]))
header = '''"""Mașinuța: WebSocket și transformări; niciun publisher locomotor G1.

Protocolul și endpointurile mașinuței sunt extrase din backendul combinat.
Motorul G1 este furnizat numai prin snapshot-uri și calea hărții selectate.
"""
import asyncio
import json
import math
import os
import secrets
import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from feature_stiching import align_point_maps
from pcd_io import read_pcd


def authorize_car(x_dashboard_token: str = Header(default=""), x_g1_token: str = Header(default="")):
    expected = os.environ.get("G1_DASHBOARD_TOKEN", "")
    if not expected or not secrets.compare_digest(x_dashboard_token or x_g1_token, expected):
        raise HTTPException(401, "Token dashboard invalid")


router = APIRouter()
g1_snapshot = lambda: {}
g1_map_path = lambda: None


def configure(snapshot, map_path):
    global g1_snapshot, g1_map_path
    g1_snapshot, g1_map_path = snapshot, map_path


def _project_g1_pcd_for_car_alignment(map_path):
    path = Path(map_path)
    planar = path.parent / "maps_2d" / path.name
    points = read_pcd(planar if planar.is_file() else path)
    # Aceeași proiecție XY ca v3; nu rasterizăm altă hartă pentru G1.
    cells = {(round(float(p[0]) / .05), round(float(p[1]) / .05)) for p in points}
    if len(cells) < 20:
        raise ValueError("Harta G1 nu conține suficiente puncte pentru aliniere")
    return [(x * .05, y * .05) for x, y in cells]


'''
body = '\n\n\n'.join(pieces)
body = body.replace('@app.get(', '@router.get(').replace('@app.post(', '@router.post(').replace('@app.websocket(', '@router.websocket(')
body = body.replace('map_path = _resolve_map_path(loaded_map_path)', 'map_path = g1_map_path()')
# Auth applies to HTTP controls, not the legacy car-bridge WebSocket protocol.
import re
body = re.sub(r'(@router\.(?:get|post)\("[^"]+")\)', r'\1, dependencies=[Depends(authorize_car)])', body)
target = ROOT / 'backend/car_integration.py'
assert not target.exists(), 'Extraction is one-off; do not overwrite integrated code'
content = header + body + '\n'
patch = '*** Begin Patch\n*** Add File: ' + str(target) + '\n' + ''.join('+' + line + '\n' for line in content.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch, text=True, check=True)
