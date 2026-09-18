"""pcd_grid_map.py — rasterizor PCD -> ocupare 2D (fără planificare A*).

Extras din fostul `autonomous_navigation.py`. Conține DOAR geometria hărții
(încărcarea PCD, estimarea podelei, câmpul de ocupare static/dinamic și
utilitarele de vizualizare a costmap-ului) folosite de localizarea LiDAR locală
și de previzualizarea costmap-ului din dashboard.

Algoritmul A* de planificare a rutei (metoda `plan`) A FOST ELIMINAT: navigarea
autonomă se face exclusiv cu Nav2 (vezi nav2_engine.py). Această clasă nu mai
poate produce o rută.
"""

import asyncio
import heapq
import math
import random
import time
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, Optional, Tuple


GridCell = Tuple[int, int]
NORMAL_CLEARANCE_RADIUS = 0.25
# Culoarul controlat păstrează cel puțin 20 cm între axa traseului și punctele
# ocupate. Protecția live pentru corp și brațe rămâne activă separat.
NARROW_CLEARANCE_RADIUS = 0.20
SAFE_CLEARANCE_RADIUS = 0.25
GOAL_SNAP_TOLERANCE = 0.20
LATERAL_RECOVERY_COOLDOWN = 8.0
DYNAMIC_OBSTACLE_RADIUS = 0.30
DYNAMIC_OBSTACLE_TTL = 2.5
DYNAMIC_SENSOR_PADDING = 0.05
LIVE_OBSTACLE_MIN_CLEARANCE = 0.28
CENTERLINE_CLEARANCE_RADIUS = 1.00
CENTERLINE_CLEARANCE_WEIGHT = 3.50
TURN_CLEARANCE_RADIUS = 0.65
TURN_CLEARANCE_WEIGHT = 12.0
OBSTACLE_WAIT_BEFORE_REPLAN = 0.12
# Evită ciclurile STOP/START produse de 1-2 cadre LiDAR lipsă. Robotul
# pornește din nou numai după ce zona a rămas liberă continuu o secundă.
OBSTACLE_CLEAR_STABLE = 1.00
OBSTACLE_SENSOR_LOSS_TIMEOUT = 5.0
# Un singur cadru întârziat nu justifică ciclul costisitor 1201/1202. În
# această fereastră nu lansăm comenzi noi, dar nici nu declarăm senzorul pierdut.
SENSOR_GLITCH_GRACE = 0.25
ROUTE_OBSTACLE_CONFIRMATION = 0.30
REPLAN_ROUTE_STABLE = 0.30
# Dacă A* nu găsește o ieșire deși LiDAR-ul confirmă un obstacol apropiat,
# permitem o singură degajare laterală verificată. Fereastra scurtă evită
# rotațiile/replanificările repetate, fără să transforme orice STOP într-un pas.
DYNAMIC_LATERAL_UNLOCK_DELAY = 0.55
NATIVE_WAYPOINT_MIN_DISTANCE = 0.65
STARTUP_SPEED_LIMIT = 0.15
STARTUP_PROGRESS_DISTANCE = 0.15
STARTUP_WAYPOINT_DISTANCE = 0.70
RECOVERY_OBSTACLE_MEMORY = 12.0
RECOVERY_OBSTACLE_MAX_ROBOT_TRAVEL = 0.55


def wrap_angle(value: float) -> float:
    return (value + math.pi) % (2.0 * math.pi) - math.pi


def navigation_sensors_ready(obstacle_guard) -> bool:
    """Folosește redundanța strictă dacă implementarea reală o oferă.

    Fake-urile/testele mai vechi rămân compatibile prin `has_fresh_data`.
    """
    if hasattr(obstacle_guard, "navigation_sensors_ready"):
        return bool(obstacle_guard.navigation_sensors_ready())
    return bool(obstacle_guard.has_fresh_data())


class PCDGridPlanner:
    def __init__(self, resolution: float = 0.15, robot_radius: float = 0.45,
                 min_obstacle_points: int = 1, comfort_radius: Optional[float] = None,
                 clearance_weight: float = 2.5, unknown_space_weight: float = 3.0):
        self.resolution = resolution
        self.robot_radius = robot_radius
        self.comfort_radius = max(robot_radius, float(comfort_radius if comfort_radius is not None else robot_radius))
        self.clearance_weight = max(0.0, float(clearance_weight))
        self.unknown_space_weight = max(0.0, float(unknown_space_weight))
        self.min_obstacle_points = max(1, int(min_obstacle_points))
        self.raw_static_occupied: set[GridCell] = set()
        self.static_occupied: set[GridCell] = set()
        self.dynamic_occupied: Dict[GridCell, float] = {}
        self.dynamic_sources: Dict[GridCell, str] = {}
        # Marjă moale pentru obstacolele temporare: nu blochează culoarele,
        # dar A* preferă ocolirea cât mai largă permisă de spațiul disponibil.
        self.dynamic_clearance_cost: Dict[GridCell, float] = {}
        self.dynamic_clearance_seen: Dict[GridCell, float] = {}
        self.dynamic_clearance_sources: Dict[GridCell, str] = {}
        self.bounds: Optional[Tuple[int, int, int, int]] = None
        self.floor_plane: Optional[dict] = None
        self.obstacle_min_z = 0.15
        self.obstacle_max_z = 1.60
        self.clearance_cost: Dict[GridCell, float] = {}
        self.centerline_cost: Dict[GridCell, float] = {}
        self.obstacle_distance: Dict[GridCell, float] = {}
        self.known_free: set[GridCell] = set()
        self.goal_snap_tolerance = 0.0

    @property
    def occupied(self) -> set[GridCell]:
        """Compatibilitate pentru diagnosticare: costmapul static + cel dinamic."""
        return self.static_occupied | set(self.dynamic_occupied)

    def add_dynamic_obstacle(self, x: float, y: float, radius: float = 0.55,
                             observed_at: Optional[float] = None,
                             source: str = "sensor") -> int:
        """Adaugă/reîmprospătează numai celulele care nu sunt deja în PCD."""
        timestamp = time.monotonic() if observed_at is None else float(observed_at)
        center = self.world_to_cell(x, y)
        changed = 0
        for ox, oy in self._inflation_offsets(radius):
            cell = (center[0] + ox, center[1] + oy)
            if cell in self.static_occupied:
                continue
            if cell not in self.dynamic_occupied:
                changed += 1
            self.dynamic_occupied[cell] = timestamp
            self.dynamic_sources[cell] = source
        return changed

    def add_dynamic_points(self, points, inflation_radius: Optional[float] = None,
                           observed_at: Optional[float] = None,
                           source: str = "lidar") -> int:
        """Inserează forma 2D observată, nu un disc artificial în jurul unui centroid."""
        timestamp = time.monotonic() if observed_at is None else float(observed_at)
        radius = max(0.0, float(
            self.robot_radius + DYNAMIC_SENSOR_PADDING
            if inflation_radius is None else inflation_radius
        ))
        centers = {
            self.world_to_cell(float(point[0]), float(point[1]))
            for point in points
            if len(point) >= 2 and math.isfinite(float(point[0])) and math.isfinite(float(point[1]))
        }
        changed = 0
        offsets = tuple(self._inflation_offsets(radius))
        for center_x, center_y in centers:
            # Un punct care coincide cu harta salvată este perete/mobilier static,
            # nu un obstacol dinamic nou.
            if (center_x, center_y) in self.raw_static_occupied:
                continue
            for offset_x, offset_y in offsets:
                cell = (center_x + offset_x, center_y + offset_y)
                if cell in self.static_occupied:
                    continue
                if cell not in self.dynamic_occupied:
                    changed += 1
                self.dynamic_occupied[cell] = timestamp
                self.dynamic_sources[cell] = source
        comfort_radius = max(radius, self.comfort_radius)
        comfort_span = max(self.resolution, comfort_radius - radius)
        comfort_offsets = tuple(self._inflation_offsets(comfort_radius))
        for center_x, center_y in centers:
            if (center_x, center_y) in self.raw_static_occupied:
                continue
            for offset_x, offset_y in comfort_offsets:
                distance = math.hypot(
                    offset_x * self.resolution, offset_y * self.resolution
                )
                if distance <= radius or distance > comfort_radius:
                    continue
                cell = (center_x + offset_x, center_y + offset_y)
                if cell in self.static_occupied or cell in self.dynamic_occupied:
                    continue
                ratio = max(0.0, min(
                    1.0, (comfort_radius - distance) / comfort_span
                ))
                cost = self.clearance_weight * (ratio ** 1.25)
                self.dynamic_clearance_cost[cell] = max(
                    cost, self.dynamic_clearance_cost.get(cell, 0.0)
                )
                self.dynamic_clearance_seen[cell] = timestamp
                self.dynamic_clearance_sources[cell] = source + "_comfort"
        if source == "lidar":
            # Forma măsurată rămâne distinctă vizual de marginea de siguranță.
            for center in centers:
                if center in self.dynamic_occupied and center not in self.static_occupied:
                    self.dynamic_sources[center] = "lidar_raw"
        return changed

    def clear_dynamic_source(self, source: str) -> int:
        cells = [
            cell for cell, value in self.dynamic_sources.items()
            if value == source or value.startswith(source + "_")
        ]
        for cell in cells:
            self.dynamic_occupied.pop(cell, None)
            self.dynamic_sources.pop(cell, None)
        comfort_cells = [
            cell for cell, value in self.dynamic_clearance_sources.items()
            if value == source or value.startswith(source + "_")
        ]
        for cell in comfort_cells:
            self.dynamic_clearance_cost.pop(cell, None)
            self.dynamic_clearance_seen.pop(cell, None)
            self.dynamic_clearance_sources.pop(cell, None)
        return len(cells) + len(comfort_cells)

    def clear_dynamic_obstacle(self, x: float, y: float, radius: float = 0.80) -> int:
        """Șterge o observație live confirmată liberă, fără a atinge harta statică."""
        center = self.world_to_cell(x, y)
        removed = 0
        for ox, oy in self._inflation_offsets(radius):
            cell = (center[0] + ox, center[1] + oy)
            if self.dynamic_occupied.pop(cell, None) is not None:
                self.dynamic_sources.pop(cell,None)
                removed += 1
        return removed

    def expire_dynamic_obstacles(self, max_age: float = 8.0,
                                 now: Optional[float] = None) -> int:
        """Elimină obstacolele live care nu au mai fost observate."""
        timestamp = time.monotonic() if now is None else float(now)
        expired = [
            cell for cell, last_seen in self.dynamic_occupied.items()
            if timestamp - last_seen > max_age
        ]
        for cell in expired:
            self.dynamic_occupied.pop(cell, None)
            self.dynamic_sources.pop(cell,None)
        expired_comfort = [
            cell for cell, last_seen in self.dynamic_clearance_seen.items()
            if timestamp - last_seen > max_age
        ]
        for cell in expired_comfort:
            self.dynamic_clearance_cost.pop(cell, None)
            self.dynamic_clearance_seen.pop(cell, None)
            self.dynamic_clearance_sources.pop(cell, None)
        return len(expired) + len(expired_comfort)

    def clear_dynamic_costmap(self) -> int:
        removed = len(self.dynamic_occupied) + len(self.dynamic_clearance_cost)
        self.dynamic_occupied.clear()
        self.dynamic_sources.clear()
        self.dynamic_clearance_cost.clear()
        self.dynamic_clearance_seen.clear()
        self.dynamic_clearance_sources.clear()
        return removed

    def dynamic_costmap_points(self) -> List[dict]:
        """Celulele temporare trimise UI-ului, distinct de PCD."""
        now = time.monotonic()
        blocked = [
            {
                "x": round(cell[0] * self.resolution, 3),
                "y": round(cell[1] * self.resolution, 3),
                "age": round(max(0.0, now - last_seen), 2),
                "source": self.dynamic_sources.get(cell, "sensor"),
            }
            for cell, last_seen in self.dynamic_occupied.items()
        ]
        comfort = [
            {
                "x": round(cell[0] * self.resolution, 3),
                "y": round(cell[1] * self.resolution, 3),
                "age": round(max(0.0, now - last_seen), 2),
                "source": self.dynamic_clearance_sources.get(cell, "sensor_comfort"),
            }
            for cell, last_seen in self.dynamic_clearance_seen.items()
            if cell not in self.dynamic_occupied
        ]
        return blocked + comfort

    def clear_robot_footprint(self, x: float, y: float) -> None:
        """Poziția curentă a robotului nu poate fi un obstacol static din PCD."""
        center = self.world_to_cell(x, y)
        for ox, oy in self._inflation_offsets(self.robot_radius):
            cell = (center[0] + ox, center[1] + oy)
            self.raw_static_occupied.discard(cell)
            self.static_occupied.discard(cell)
            self.dynamic_occupied.pop(cell, None)
            self.dynamic_sources.pop(cell,None)
            self.known_free.add(cell)

    def _inflation_offsets(self, radius: float):
        """Celule aflate realmente în rază, fără rotunjirea 0,48 m la 0,60 m."""
        padding = max(1, math.ceil(radius / self.resolution))
        tolerance = self.resolution * 0.5
        for ox in range(-padding, padding + 1):
            for oy in range(-padding, padding + 1):
                if math.hypot(ox * self.resolution, oy * self.resolution) <= radius + tolerance:
                    yield ox, oy

    def _build_obstacle_distance_field(self, sources: set[GridCell],
                                       max_radius: float) -> Dict[GridCell, float]:
        """Distanță 2D continuă până la obstacol, pentru axa culoarului."""
        if not sources or not self.bounds:
            return {}
        min_x, max_x, min_y, max_y = self.bounds
        distances: Dict[GridCell, float] = {cell: 0.0 for cell in sources}
        frontier = [(0.0, cell) for cell in sources]
        heapq.heapify(frontier)
        neighbors = (
            (1, 0, self.resolution), (-1, 0, self.resolution),
            (0, 1, self.resolution), (0, -1, self.resolution),
            (1, 1, self.resolution * math.sqrt(2)),
            (1, -1, self.resolution * math.sqrt(2)),
            (-1, 1, self.resolution * math.sqrt(2)),
            (-1, -1, self.resolution * math.sqrt(2)),
        )
        while frontier:
            distance, cell = heapq.heappop(frontier)
            if distance > distances.get(cell, math.inf) + 1e-9:
                continue
            for dx, dy, step in neighbors:
                nxt = (cell[0] + dx, cell[1] + dy)
                next_distance = distance + step
                if (next_distance > max_radius
                        or not min_x <= nxt[0] <= max_x
                        or not min_y <= nxt[1] <= max_y
                        or next_distance >= distances.get(nxt, math.inf)):
                    continue
                distances[nxt] = next_distance
                heapq.heappush(frontier, (next_distance, nxt))
        return distances

    @staticmethod
    def _iter_pcd_points(path: str):
        data = False
        with Path(path).open("r", encoding="utf-8", errors="ignore") as stream:
            for line in stream:
                if not data:
                    if line.lstrip().upper().startswith("DATA"):
                        if "ascii" not in line.lower():
                            raise ValueError("Navigatorul suportă momentan doar PCD ASCII")
                        data = True
                    continue
                fields = line.split()
                if len(fields) < 3:
                    continue
                try:
                    yield tuple(map(float, fields[:3]))
                except ValueError:
                    continue

    @staticmethod
    def _least_squares_plane(points):
        sx=sy=sz=sxx=syy=sxy=sxz=syz=0.0
        for x, y, z in points:
            sx+=x; sy+=y; sz+=z; sxx+=x*x; syy+=y*y
            sxy+=x*y; sxz+=x*z; syz+=y*z
        matrix=[[sxx,sxy,sx,sxz],[sxy,syy,sy,syz],[sx,sy,float(len(points)),sz]]
        for column in range(3):
            pivot=max(range(column,3), key=lambda row: abs(matrix[row][column]))
            if abs(matrix[pivot][column]) < 1e-9:
                return None
            matrix[column],matrix[pivot]=matrix[pivot],matrix[column]
            divisor=matrix[column][column]
            matrix[column]=[value/divisor for value in matrix[column]]
            for row in range(3):
                if row==column:
                    continue
                factor=matrix[row][column]
                matrix[row]=[value-factor*base for value,base in zip(matrix[row],matrix[column])]
        return matrix[0][3],matrix[1][3],matrix[2][3]

    @classmethod
    def _estimate_floor_plane(cls, sample, tolerance: float = 0.08):
        if len(sample) < 3:
            return None
        if len(sample) < 200:
            # Compatibilitate pentru hărți/teste foarte rare: percentila joasă
            # este mai sigură decât planul dominant, care poate fi un birou.
            floor_z=sorted(point[2] for point in sample)[max(0,int((len(sample)-1)*0.15))]
            return {"a":0.0,"b":0.0,"c":floor_z,"tilt_deg":0.0,
                    "inliers":sum(abs(p[2]-floor_z)<=tolerance for p in sample),
                    "sample_size":len(sample),"rms":0.0}
        rng=random.Random(len(sample)*2654435761)
        threshold=max(0.045,min(0.10,float(tolerance)))
        best=None
        best_inliers=[]
        for _ in range(140):
            p1,p2,p3=rng.sample(sample,3)
            determinant=(p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1])
            if abs(determinant)<0.04:
                continue
            a=((p1[2]-p3[2])*(p2[1]-p3[1])-(p2[2]-p3[2])*(p1[1]-p3[1]))/determinant
            b=((p1[0]-p3[0])*(p2[2]-p3[2])-(p2[0]-p3[0])*(p1[2]-p3[2]))/determinant
            if math.hypot(a,b)>0.60:
                continue
            c=p1[2]-a*p1[0]-b*p1[1]
            inliers=[p for p in sample if abs(p[2]-(a*p[0]+b*p[1]+c))<=threshold]
            if len(inliers)>len(best_inliers):
                best=(a,b,c); best_inliers=inliers
        if best is None or len(best_inliers)<max(100,len(sample)*0.06):
            return None
        a,b,c=cls._least_squares_plane(best_inliers) or best
        inliers=[p for p in sample if abs(p[2]-(a*p[0]+b*p[1]+c))<=threshold]
        rms=math.sqrt(sum((p[2]-(a*p[0]+b*p[1]+c))**2 for p in inliers)/max(1,len(inliers)))
        return {"a":a,"b":b,"c":c,"tilt_deg":math.degrees(math.atan(math.hypot(a,b))),
                "inliers":len(inliers),"sample_size":len(sample),"rms":rms}

    def load(self, path: str, obstacle_min_z: float = 0.15,
             obstacle_max_z: float = 1.60, level_to_floor: bool = True,
             floor_tolerance: float = 0.08,
             clear_xy: Optional[Tuple[float, float]] = None,
             clear_radius: float = 0.38) -> None:
        self.obstacle_min_z = float(obstacle_min_z)
        self.obstacle_max_z = float(obstacle_max_z)
        raw_hits: Dict[GridCell, int] = {}
        floor_cells: set[GridCell] = set()
        sample=[]
        point_count=0
        min_cell_x=min_cell_y=math.inf
        max_cell_x=max_cell_y=-math.inf
        rng=random.Random(0xC05A4A9)
        for x,y,z in self._iter_pcd_points(path):
            point_count+=1
            cell=self.world_to_cell(x,y)
            min_cell_x=min(min_cell_x,cell[0]); max_cell_x=max(max_cell_x,cell[0])
            min_cell_y=min(min_cell_y,cell[1]); max_cell_y=max(max_cell_y,cell[1])
            if len(sample)<5000:
                sample.append((x,y,z))
            else:
                index=rng.randrange(point_count)
                if index<5000:
                    sample[index]=(x,y,z)
        if not point_count:
            raise ValueError("Harta PCD nu conține puncte")

        self.floor_plane=self._estimate_floor_plane(sample,floor_tolerance) if level_to_floor else None
        if level_to_floor and self.floor_plane is None:
            raise ValueError("Planul podelei nu a putut fi detectat sigur")
        for x,y,z in self._iter_pcd_points(path):
            relative_z=z
            if self.floor_plane:
                relative_z=z-(self.floor_plane["a"]*x+self.floor_plane["b"]*y+self.floor_plane["c"])
                if abs(relative_z)<=floor_tolerance:
                    # Podeaua detectată nu este niciodată obstacol, chiar dacă
                    # operatorul coboară manual limita minimă a filtrului.
                    floor_cells.add(self.world_to_cell(x, y))
                    continue
            if obstacle_min_z <= relative_z <= obstacle_max_z:
                if clear_xy and math.hypot(x-clear_xy[0],y-clear_xy[1])<=clear_radius:
                    continue
                cell=self.world_to_cell(x,y)
                raw_hits[cell]=raw_hits.get(cell,0)+1

        padding = max(1, math.ceil(self.robot_radius / self.resolution))
        inflated: set[GridCell] = set()
        offsets = tuple(self._inflation_offsets(self.robot_radius))
        raw = {cell for cell, hits in raw_hits.items() if hits >= self.min_obstacle_points}
        for cx, cy in raw:
            for ox, oy in offsets:
                inflated.add((cx + ox, cy + oy))
        self.raw_static_occupied = raw
        self.static_occupied = inflated
        # Podeaua măsurată este spațiu cunoscut. Extinderea mică umple golurile
        # dintre razele LiDAR fără a transforma întreaga hartă în liber.
        self.known_free = set()
        known_offsets = tuple(self._inflation_offsets(max(0.18, self.resolution * 1.5)))
        for cell_x, cell_y in floor_cells:
            for offset_x, offset_y in known_offsets:
                cell = (cell_x + offset_x, cell_y + offset_y)
                if cell not in inflated:
                    self.known_free.add(cell)
        self.dynamic_occupied = {}
        self.dynamic_sources = {}
        self.dynamic_clearance_cost = {}
        self.dynamic_clearance_seen = {}
        self.dynamic_clearance_sources = {}
        margin = max(2, padding)
        self.bounds = (int(min_cell_x)-margin,int(max_cell_x)+margin,
                       int(min_cell_y)-margin,int(max_cell_y)+margin)
        self.obstacle_distance = self._build_obstacle_distance_field(
            raw, max(self.comfort_radius, CENTERLINE_CLEARANCE_RADIUS)
        )
        self.clearance_cost = {}
        self.centerline_cost = {}
        comfort_span = max(1e-6, self.comfort_radius - self.robot_radius)
        for cell, distance in self.obstacle_distance.items():
            if cell in inflated:
                continue
            if self.comfort_radius > self.robot_radius and self.clearance_weight > 0:
                ratio = max(0.0, min(
                    1.0, (self.comfort_radius - distance) / comfort_span
                ))
                if ratio > 0.0:
                    self.clearance_cost[cell] = (
                        self.clearance_weight * (ratio ** 1.25)
                    )
            center_ratio = max(
                0.0,
                (CENTERLINE_CLEARANCE_RADIUS - distance)
                / CENTERLINE_CLEARANCE_RADIUS,
            )
            if center_ratio > 0.0:
                # Termen moderat, continuu: separă zona plată și alege mijlocul
                # culoarului, dar rămâne traversabil în spații înguste.
                self.centerline_cost[cell] = (
                    CENTERLINE_CLEARANCE_WEIGHT * center_ratio * center_ratio
                )

    def world_to_cell(self, x: float, y: float) -> GridCell:
        return (round(x / self.resolution), round(y / self.resolution))

    def cell_to_world(self, cell: GridCell) -> Tuple[float, float]:
        return (cell[0] * self.resolution, cell[1] * self.resolution)

    def _valid(self, cell: GridCell) -> bool:
        if not self.bounds:
            return False
        min_x, max_x, min_y, max_y = self.bounds
        return (min_x <= cell[0] <= max_x and min_y <= cell[1] <= max_y
                and cell not in self.static_occupied
                and cell not in self.dynamic_occupied)

    def _line_is_free(self, start: GridCell, end: GridCell) -> bool:
        """Supercover aproximativ: nu scurtăm traseul prin pereți/colțuri."""
        dx, dy = end[0] - start[0], end[1] - start[1]
        steps = max(abs(dx), abs(dy))
        if steps == 0:
            return self._valid(start)
        previous = start
        for index in range(1, steps + 1):
            t = index / steps
            cell = (round(start[0] + dx * t), round(start[1] + dy * t))
            if not self._valid(cell):
                return False
            if cell[0] != previous[0] and cell[1] != previous[1]:
                if not self._valid((cell[0], previous[1])) or not self._valid((previous[0], cell[1])):
                    return False
            previous = cell
        return True

    def segment_is_free(self, start_xy: Tuple[float, float],
                        end_xy: Tuple[float, float]) -> bool:
        """Verificare publică folosită înainte de trecerea anticipată la următorul waypoint."""
        return self._line_is_free(
            self.world_to_cell(*start_xy), self.world_to_cell(*end_xy)
        )

    def smooth_handoff_is_safe(self, start_xy: Tuple[float, float],
                               waypoint_xy: Tuple[float, float],
                               following_xy: Tuple[float, float]) -> bool:
        """Permite scurtătura numai dacă nu taie colțul sau zona de confort."""
        start = self.world_to_cell(*start_xy)
        waypoint = self.world_to_cell(*waypoint_xy)
        following = self.world_to_cell(*following_xy)
        direct = self._line_cells(start, following)
        first = self._line_cells(start, waypoint)
        second = self._line_cells(waypoint, following)
        if direct is None or first is None or second is None:
            return False
        via = first + second[1:]
        return self._shortcut_is_safer_or_equal(direct, via)

    def _line_cells(self, start: GridCell, end: GridCell) -> Optional[List[GridCell]]:
        dx,dy=end[0]-start[0],end[1]-start[1]
        steps=max(abs(dx),abs(dy))
        if steps==0:
            return [start] if self._valid(start) else None
        cells=[start]
        previous=start
        for index in range(1,steps+1):
            t=index/steps
            cell=(round(start[0]+dx*t),round(start[1]+dy*t))
            if not self._valid(cell):
                return None
            if cell[0]!=previous[0] and cell[1]!=previous[1]:
                if not self._valid((cell[0],previous[1])) or not self._valid((previous[0],cell[1])):
                    return None
            if cell!=cells[-1]:
                cells.append(cell)
            previous=cell
        return cells

    def _cells_cost(self, cells: List[GridCell]) -> float:
        total=0.0
        for previous,cell in zip(cells,cells[1:]):
            step=math.hypot(cell[0]-previous[0],cell[1]-previous[1])
            unknown_penalty = 0.0 if cell in self.known_free else self.unknown_space_weight
            total+=step*(1.0+self._navigation_penalty(cell)+unknown_penalty)
        return total

    def _navigation_penalty(self, cell: GridCell) -> float:
        return (
            self.clearance_cost.get(cell, 0.0)
            + self.centerline_cost.get(cell, 0.0)
            + self.dynamic_clearance_cost.get(cell, 0.0)
        )

    def _turn_clearance_penalty(self, cell: GridCell, turn: float) -> float:
        """Cost separat pentru locul unde corpul își schimbă orientarea.

        Un segment poate încăpea pe lângă un colț, dar rotația umerilor și a
        brațelor cere mai mult spațiu. Penalizarea este continuă: nu închide
        culoarele reale, însă mută virajul spre centrul zonei libere.
        """
        if turn <= 1e-6:
            return 0.0
        desired = max(
            self.robot_radius + 0.10,
            min(TURN_CLEARANCE_RADIUS, self.comfort_radius),
        )
        clearance = self.obstacle_distance.get(cell, math.inf)
        if clearance >= desired:
            return 0.0
        ratio = max(0.0, min(1.0, (desired - clearance) / max(desired, 1e-6)))
        return (
            turn / (math.pi / 4.0)
        ) * TURN_CLEARANCE_WEIGHT * ratio * ratio

    def _cells_clearance_risk(self, cells: List[GridCell]) -> Tuple[float, float]:
        """Întoarce riscul maxim și mediu; un colț periculos nu se pierde în medie."""
        if not cells:
            return 0.0, 0.0
        penalties = [self._navigation_penalty(cell) for cell in cells]
        return max(penalties), sum(penalties) / len(penalties)

    def _shortcut_is_safer_or_equal(self, direct: List[GridCell],
                                     via: List[GridCell]) -> bool:
        """O scurtătură trebuie să păstreze și distanța, nu doar costul total."""
        direct_peak, direct_mean = self._cells_clearance_risk(direct)
        via_peak, via_mean = self._cells_clearance_risk(via)
        return (
            direct_peak <= via_peak + 0.01
            and direct_mean <= via_mean + 0.01
            and self._cells_cost(direct) <= self._cells_cost(via) * 1.005
        )

    def _polyline_cost(self, points: List[Tuple[float, float]]) -> Optional[float]:
        total = 0.0
        for start_xy, end_xy in zip(points, points[1:]):
            cells = self._line_cells(
                self.world_to_cell(*start_xy), self.world_to_cell(*end_xy)
            )
            if cells is None:
                return None
            total += self._cells_cost(cells)
        return total

    def _polyline_cells(self, points: List[Tuple[float, float]]) -> Optional[List[GridCell]]:
        cells: List[GridCell] = []
        for start_xy, end_xy in zip(points, points[1:]):
            segment = self._line_cells(
                self.world_to_cell(*start_xy), self.world_to_cell(*end_xy)
            )
            if segment is None:
                return None
            cells.extend(segment if not cells else segment[1:])
        return cells

    def _simplify_polyline_preserving_risk(
            self, points: List[Tuple[float, float]],
    ) -> List[Tuple[float, float]]:
        """Elimină punctele fillet redundante fără a părăsi axa sigură."""
        if len(points) <= 2:
            return points
        reduced = [points[0]]
        anchor = 0
        while anchor < len(points) - 1:
            candidate = len(points) - 1
            while candidate > anchor + 1:
                direct = self._line_cells(
                    self.world_to_cell(*points[anchor]),
                    self.world_to_cell(*points[candidate]),
                )
                via = self._polyline_cells(points[anchor:candidate + 1])
                if (direct is not None and via is not None
                        and self._shortcut_is_safer_or_equal(direct, via)):
                    break
                candidate -= 1
            reduced.append(points[candidate])
            anchor = candidate
        return reduced

    def _shortcut_preserves_execution_clearance(
            self, direct: List[GridCell], via: List[GridCell],
    ) -> bool:
        """Permite o comandă 1102 lungă când geometria hard rămâne sigură.

        Costul moale al costmapului variază la fiecare celulă și producea
        micro-viraje fără valoare practică. Acceptăm o diferență mai mică decât
        jumătate din rezoluția hărții, dar nu trecem niciodată printr-o celulă
        blocată și nu degradăm marginea dinamică LiDAR.
        """
        if not direct or not via:
            return False
        if self._shortcut_is_safer_or_equal(direct, via):
            return True
        clearance_loss = min(0.05, self.resolution * 0.50)
        direct_clearance = min(
            self.obstacle_distance.get(cell, math.inf) for cell in direct
        )
        via_clearance = min(
            self.obstacle_distance.get(cell, math.inf) for cell in via
        )
        direct_dynamic_peak = max(
            (self.dynamic_clearance_cost.get(cell, 0.0) for cell in direct),
            default=0.0,
        )
        via_dynamic_peak = max(
            (self.dynamic_clearance_cost.get(cell, 0.0) for cell in via),
            default=0.0,
        )
        direct_unknown = sum(cell not in self.known_free for cell in direct) / len(direct)
        via_unknown = sum(cell not in self.known_free for cell in via) / len(via)
        return (
            direct_clearance + clearance_loss >= via_clearance
            and direct_dynamic_peak <= via_dynamic_peak + 0.01
            and direct_unknown <= via_unknown + 0.01
            and self._cells_cost(direct) <= self._cells_cost(via) * 1.12
        )

    def _simplify_polyline_for_execution(
            self, points: List[Tuple[float, float]],
    ) -> List[Tuple[float, float]]:
        """Păstrează doar schimbările de direcție necesare pentru siguranță."""
        if len(points) <= 2:
            return points
        reduced = [points[0]]
        anchor = 0
        while anchor < len(points) - 1:
            candidate = len(points) - 1
            while candidate > anchor + 1:
                direct = self._line_cells(
                    self.world_to_cell(*points[anchor]),
                    self.world_to_cell(*points[candidate]),
                )
                via = self._polyline_cells(points[anchor:candidate + 1])
                if (direct is not None and via is not None
                        and self._shortcut_preserves_execution_clearance(direct, via)):
                    break
                candidate -= 1
            reduced.append(points[candidate])
            anchor = candidate
        return reduced

    def _round_safe_corners(self, points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        """Rotunjește virajele, dar numai în spațiul hard și de confort verificat."""
        if len(points) < 3:
            return points
        rounded = [points[0]]
        for previous, corner, following in zip(points, points[1:-1], points[2:]):
            incoming = (corner[0] - previous[0], corner[1] - previous[1])
            outgoing = (following[0] - corner[0], following[1] - corner[1])
            incoming_length = math.hypot(*incoming)
            outgoing_length = math.hypot(*outgoing)
            if incoming_length < 0.20 or outgoing_length < 0.20:
                rounded.append(corner)
                continue
            incoming_yaw = math.atan2(incoming[1], incoming[0])
            outgoing_yaw = math.atan2(outgoing[1], outgoing[0])
            turn = abs(wrap_angle(outgoing_yaw - incoming_yaw))
            # Deviațiile mici rămân un singur segment; rotunjirea lor producea
            # grupurile de waypoint-uri albe și mersul „șerpuit”.
            if turn < math.radians(25.0) or turn > math.radians(145.0):
                rounded.append(corner)
                continue

            trim = min(0.32, incoming_length * 0.28, outgoing_length * 0.28)
            entry = (
                corner[0] - incoming[0] / incoming_length * trim,
                corner[1] - incoming[1] / incoming_length * trim,
            )
            exit_point = (
                corner[0] + outgoing[0] / outgoing_length * trim,
                corner[1] + outgoing[1] / outgoing_length * trim,
            )
            curve = [entry]
            # Un singur punct median este suficient pentru o curbă sigură.
            # Trei eșantioane intermediare produceau 20-30 de waypoint-uri și
            # obligau API 1102 să ia aceeași decizie de prea multe ori.
            for t in (0.50,):
                one_minus_t = 1.0 - t
                curve.append((
                    one_minus_t * one_minus_t * entry[0]
                    + 2.0 * one_minus_t * t * corner[0]
                    + t * t * exit_point[0],
                    one_minus_t * one_minus_t * entry[1]
                    + 2.0 * one_minus_t * t * corner[1]
                    + t * t * exit_point[1],
                ))
            curve.append(exit_point)
            rounded.extend(curve)
        rounded.append(points[-1])

        deduplicated = [rounded[0]]
        for point in rounded[1:]:
            if math.hypot(point[0] - deduplicated[-1][0], point[1] - deduplicated[-1][1]) >= 0.04:
                deduplicated.append(point)
        simplified = self._simplify_polyline_preserving_risk(deduplicated)
        original_cells = self._polyline_cells(points)
        rounded_cells = self._polyline_cells(simplified)
        if original_cells is None or rounded_cells is None:
            return points
        if not self._shortcut_is_safer_or_equal(rounded_cells, original_cells):
            return points
        return simplified

    def _nearest_free(self, cell: GridCell, max_radius: int = 6) -> Optional[GridCell]:
        if self._valid(cell):
            return cell
        for radius in range(1, max_radius + 1):
            candidates = []
            for dx in range(-radius, radius + 1):
                for dy in (-radius, radius):
                    candidates.append((cell[0] + dx, cell[1] + dy))
            for dy in range(-radius + 1, radius):
                for dx in (-radius, radius):
                    candidates.append((cell[0] + dx, cell[1] + dy))
            for candidate in candidates:
                if self._valid(candidate):
                    return candidate
        return None

