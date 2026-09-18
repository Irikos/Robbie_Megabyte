"""Fără ROS/robot: regresii pentru înlocuirea inițializării SDK la import."""
import json
import math
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from ros_sport_client import RosSportClient


class FakeNode:
    def __init__(self, response=None, subscriptions=1):
        self.sent = []
        self.response = response
        self.sport_request_publisher = SimpleNamespace(get_subscription_count=lambda: subscriptions)
        self.arm_request_publisher = SimpleNamespace(get_subscription_count=lambda: subscriptions)

    def send_request(self, api_id, params, service):
        self.sent.append((api_id, params, service))
        return 123

    def wait_response(self, request_id, api_id, sent_at, timeout):
        assert request_id == 123
        assert api_id == self.sent[-1][0]
        return self.response


def test_import_does_not_initialize_sdk_or_run_ros_cli():
    backend = str(Path(__file__).resolve().parents[1])
    code = '''
import builtins, subprocess
real_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    assert not name.startswith(("unitree_sdk2py", "cyclonedds")), name
    return real_import(name, *args, **kwargs)
def forbidden(*args, **kwargs):
    raise AssertionError("Import must not spawn ROS CLI")
builtins.__import__ = guarded_import
subprocess.run = forbidden
import robot_client
assert not robot_client.sport_client.is_sdk_available()
'''
    subprocess.run([sys.executable, "-c", code], cwd=backend, check=True, timeout=10)


def test_binding_is_passive_and_velocity_is_not_scaled():
    from robot_client import SportClient
    node = FakeNode({"status_code": 0, "payload": {}})
    client = SportClient()
    client.initialize_ros(node)
    assert node.sent == []
    assert client._sdk_client.SetVelocity(0.3, -0.1, 0.2, 0.35) == 0
    assert node.sent == [(7105, {"velocity": [0.3, -0.1, 0.2], "duration": 0.35}, "sport")]


@pytest.mark.parametrize("api_id", [1102, 1201, 1202, 9999])
def test_native_navigation_forbidden(api_id):
    node = FakeNode()
    with pytest.raises(ValueError):
        RosSportClient(node)._Call(api_id, "{}")
    assert node.sent == []


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_nonfinite_velocity_never_published(value):
    node = FakeNode()
    with pytest.raises(ValueError):
        RosSportClient(node).SetVelocity(value, 0, 0)
    assert node.sent == []


def test_unavailable_service_does_not_claim_success():
    node = FakeNode(subscriptions=0)
    with pytest.raises(TimeoutError, match="subscriber"):
        RosSportClient(node, timeout=0).SetFsmId(802)
    assert node.sent == []


def test_missing_response_does_not_claim_success():
    with pytest.raises(TimeoutError, match="răspuns"):
        RosSportClient(FakeNode()).SetFsmId(802)


@pytest.mark.parametrize("response, expected", [
    ({"status_code": 9, "payload": {}}, 9),
    ({"status_code": 0, "payload": {"errorCode": 7}}, 7),
    ({"status_code": 0, "payload": {"succeed": False}}, -1),
])
def test_negative_acknowledgements_preserved(response, expected):
    assert RosSportClient(FakeNode(response)).SetFsmId(802) == expected


def test_fsm_and_arm_routed_to_correct_services():
    node = FakeNode({"status_code": 0, "payload": {"data": 802}})
    assert RosSportClient(node).GetFsmId() == (0, 802)
    assert node.sent[-1] == (7001, {}, "sport")
    assert RosSportClient(node, service="arm").ExecuteAction(17) == 0
    assert node.sent[-1] == (7106, {"data": 17}, "arm")
