"""Conversia explicită dintre viteza ROS 2 și comanda locomotorie G1.

Nav2 publică ``geometry_msgs/Twist`` în cadrul corpului ``base_link``:
X înainte, Y la stânga și Z pozitiv în sens trigonometric. API 7105 primește
aceleași trei componente ca ``[vx, vy, yaw_rate]``. Conversia este ținută
într-un modul pur și testabil pentru a nu ascunde rotații, câștiguri sau
schimbări de semn în bucla care publică spre robot.

Important: adaptorul nu ridică niciodată o comandă mică la o viteză minimă.
Astfel, o reducere sau un zero produs de Collision Monitor rămâne neschimbat.
Vitezele de lucru se configurează în Nav2, înainte de filtrul de coliziune.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence


@dataclass(frozen=True)
class VelocityLimits:
    """Limite finale independente de selectorul sursei de comandă."""

    forward: float = 0.80
    reverse: float = 0.35
    lateral: float = 0.25
    angular: float = 1.60

    def __post_init__(self) -> None:
        values = (self.forward, self.reverse, self.lateral, self.angular)
        if not all(math.isfinite(value) and value > 0.0 for value in values):
            raise ValueError("Limitele vitezei trebuie să fie finite și pozitive")


@dataclass(frozen=True)
class BodyFrameTransform:
    """Mapare manuală a axelor ROS ``base_link`` către vectorul API 7105."""

    x_sign: int = 1
    y_sign: int = 1
    yaw_sign: int = 1

    def __post_init__(self) -> None:
        if any(sign not in {-1, 1} for sign in (self.x_sign, self.y_sign, self.yaw_sign)):
            raise ValueError("Semnele transformării axelor trebuie să fie -1 sau 1")

    def description(self) -> dict[str, str]:
        return {
            "input_frame": "base_link",
            "ros": "x=forward,y=left,yaw=ccw",
            "unitree_7105": "vx=forward,vy=left,yaw_rate=ccw",
            "mapping": f"[{self.x_sign:+d}x,{self.y_sign:+d}y,{self.yaw_sign:+d}yaw]",
        }


DEFAULT_LIMITS = VelocityLimits()
DEFAULT_TRANSFORM = BodyFrameTransform()


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def ros_twist_to_unitree(
    velocity: Sequence[float],
    *,
    forward_limit: float | None = None,
    limits: VelocityLimits = DEFAULT_LIMITS,
    transform: BodyFrameTransform = DEFAULT_TRANSFORM,
) -> tuple[float, float, float]:
    """Convertește ``(linear.x, linear.y, angular.z)`` în vectorul API 7105.

    Intrarea este deja o viteză în cadrul corpului; nu se rotește încă o dată
    cu yaw-ul global. Funcția aplică explicit semnele axelor și limitele finale,
    fără gain, deadband ori prag minim de mișcare.
    """

    if len(velocity) != 3:
        raise ValueError("Comanda ROS trebuie să conțină exact vx, vy și wz")
    ros_vx, ros_vy, ros_wz = (float(value) for value in velocity)
    if not all(math.isfinite(value) for value in (ros_vx, ros_vy, ros_wz)):
        raise ValueError("Comanda ROS conține o valoare nefinita")

    selected_forward_limit = limits.forward if forward_limit is None else float(forward_limit)
    if not math.isfinite(selected_forward_limit) or selected_forward_limit <= 0.0:
        raise ValueError("Limita vitezei înainte trebuie să fie finită și pozitivă")
    selected_forward_limit = min(selected_forward_limit, limits.forward)

    unitree_vx = transform.x_sign * ros_vx
    unitree_vy = transform.y_sign * ros_vy
    unitree_wz = transform.yaw_sign * ros_wz
    return (
        _clamp(unitree_vx, -limits.reverse, selected_forward_limit),
        _clamp(unitree_vy, -limits.lateral, limits.lateral),
        _clamp(unitree_wz, -limits.angular, limits.angular),
    )
