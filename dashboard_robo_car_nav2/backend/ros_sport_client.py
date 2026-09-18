"""Compatibilitate cu operațiile Sport folosite de UI, prin ROS 2 unitree_api.

Nu importă SDK-ul/CycloneDDS Python și nu creează participanți sau publisheri.
Folosește publisherul și corelarea răspunsurilor din nodul motorului Nav2.
Instanțierea nu trimite comenzi, nici măcar pentru FSM.
"""
import json
import math
import time

ARM_ACTIONS = {"release arm": 99, "two-hand kiss": 11, "clap": 17,
               "high wave": 26, "shake hand": 27}


class RosSportClient:
    def __init__(self, node, service="sport", timeout=2.0):
        if service not in {"sport", "arm"}:
            raise ValueError("Serviciu ROS API necunoscut")
        self.node = node
        self.service = service
        self.timeout = timeout

    def _Call(self, api_id, parameter):
        allowed = ({7001, 7002, 7101, 7104, 7105, 7107, 7110, 7111}
                   if self.service == "sport" else {7106})
        if api_id not in allowed:
            raise ValueError(f"API {api_id} nu este permis pe {self.service}")
        params = json.loads(parameter)
        publisher = (self.node.sport_request_publisher if self.service == "sport"
                     else self.node.arm_request_publisher)
        deadline = time.monotonic() + self.timeout
        while publisher.get_subscription_count() < 1:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"/api/{self.service}/request nu are subscriber")
            time.sleep(0.02)
        sent_at = time.monotonic()
        request_id = self.node.send_request(api_id, params, service=self.service)
        response = self.node.wait_response(request_id, api_id, sent_at, self.timeout)
        if response is None:
            raise TimeoutError(f"API {api_id} nu a răspuns în {self.timeout}s")
        code = int(response["status_code"])
        payload = response.get("payload") or {}
        if code == 0 and isinstance(payload, dict):
            code = int(payload.get("errorCode", 0) or 0)
            if payload.get("succeed") is False and code == 0:
                code = -1
        return code, json.dumps(payload)

    def SetFsmId(self, fsm_id):
        return self._Call(7101, json.dumps({"data": int(fsm_id)}))[0]

    def GetFsmId(self):
        code, payload = self._Call(7001, "{}")
        return code, json.loads(payload).get("data") if code == 0 else None

    def Damp(self):
        return self.SetFsmId(1)

    def HighStand(self):
        return self._Call(7104, json.dumps({"data": (1 << 32) - 1}))[0]

    def SetVelocity(self, vx, vy, wz, duration=0.35):
        values = [float(vx), float(vy), float(wz)]
        if not all(math.isfinite(v) for v in values + [float(duration)]):
            raise ValueError("Viteză sau durată nefinita")
        return self._Call(7105, json.dumps({"velocity": values, "duration": duration}))[0]

    def ExecuteAction(self, action_id):
        return self._Call(7106, json.dumps({"data": int(action_id)}))[0]
