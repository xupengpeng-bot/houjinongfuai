from __future__ import annotations

import argparse
import json
import signal
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

try:
    import serial  # type: ignore
except Exception as exc:  # pragma: no cover
    print(f"PySerial unavailable: {exc}", file=sys.stderr)
    print("Install with: python -m pip install pyserial", file=sys.stderr)
    raise SystemExit(2)


ENVELOPE_KEYS = {
    "protocol",
    "protocolVersion",
    "protocol_version",
    "imei",
    "msgId",
    "msg_id",
    "seq",
    "seqNo",
    "seq_no",
    "type",
    "msgType",
    "msg_type",
    "ts",
    "deviceTs",
    "device_ts",
    "correlationId",
    "correlation_id",
    "sessionRef",
    "session_ref",
    "runState",
    "run_state",
    "powerState",
    "power_state",
    "alarmCodes",
    "alarm_codes",
    "cumulativeRuntimeSec",
    "cumulative_runtime_sec",
    "cumulativeEnergyWh",
    "cumulative_energy_wh",
    "cumulativeFlow",
    "cumulative_flow",
    "payload",
    "integrity",
    "event_type",
    "eventType",
}

REVERSE_EVENT_TYPE_MAP = {
    "DEVICE_REGISTERED": "REGISTERED",
    "DEVICE_HEARTBEAT": "HEARTBEAT",
    "DEVICE_STATE_SNAPSHOT": "STATE_SNAPSHOT",
    "DEVICE_QUERY_RESULT": "QUERY_RESULT",
    "DEVICE_RUNTIME_TICK": "RUNTIME_TICK",
    "DEVICE_RUNTIME_STOPPED": "RUNTIME_STOPPED",
    "DEVICE_ALARM_RAISED": "EVENT_REPORT",
    "DEVICE_COMMAND_ACKED": "COMMAND_ACK",
    "DEVICE_COMMAND_NACKED": "COMMAND_NACK",
}

IGNORED_INBOUND_MSG_TYPES = {"COMMAND_DISPATCH", "PULL_PENDING_COMMANDS"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            import os

            os.environ.setdefault(key, value)


class BackendBridgeClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                text = resp.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} {path}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Network error {path}: {exc}") from exc

        parsed = json.loads(text) if text else {}
        if isinstance(parsed, dict) and isinstance(parsed.get("data"), dict):
            return parsed["data"]
        return parsed if isinstance(parsed, dict) else {"raw": parsed}


class SerialGatewayBridge:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.client = BackendBridgeClient(args.base_url, args.http_timeout)
        self.sequence = args.seq_start
        self.stopping = False
        self.serial_port = None
        self.bridge_id = args.bridge_id or self._default_bridge_id(args.port)

    def _default_bridge_id(self, port_name: str) -> str:
        normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in port_name).strip("-")
        return f"serial-{normalized or 'default'}"

    def _next_seq(self) -> int:
        current = self.sequence
        self.sequence += 1
        return current

    def install_signal_handlers(self) -> None:
        def _handle(_signum: int, _frame: Any) -> None:
            self.stopping = True

        signal.signal(signal.SIGINT, _handle)
        signal.signal(signal.SIGTERM, _handle)

    def open_serial(self) -> None:
        kwargs = {
            "baudrate": self.args.baudrate,
            "timeout": self.args.read_timeout,
            "write_timeout": self.args.write_timeout,
        }
        if "://" in self.args.port:
            self.serial_port = serial.serial_for_url(self.args.port, **kwargs)
        else:
            self.serial_port = serial.Serial(self.args.port, **kwargs)

    def close_serial(self) -> None:
        if self.serial_port is not None and getattr(self.serial_port, "is_open", False):
            self.serial_port.close()

    def _normalize_msg_type(self, frame: dict[str, Any]) -> str:
        candidate = frame.get("type") or frame.get("msgType") or frame.get("msg_type")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().upper()
        event_type = frame.get("eventType") or frame.get("event_type")
        if isinstance(event_type, str) and event_type.strip():
            return REVERSE_EVENT_TYPE_MAP.get(event_type.strip().upper(), "STATE_SNAPSHOT")
        return "STATE_SNAPSHOT"

    def _build_payload(self, frame: dict[str, Any]) -> dict[str, Any]:
        payload = frame.get("payload")
        if isinstance(payload, dict):
            return payload
        return {key: value for key, value in frame.items() if key not in ENVELOPE_KEYS}

    def _build_envelope(self, frame: dict[str, Any]) -> dict[str, Any]:
        return {
            "protocol": frame.get("protocol") or frame.get("protocolVersion") or frame.get("protocol_version") or self.args.protocol_version,
            "imei": frame.get("imei") or self.args.imei,
            "msg_id": frame.get("msgId") or frame.get("msg_id") or str(uuid.uuid4()),
            "seq": frame.get("seq") or frame.get("seqNo") or frame.get("seq_no") or self._next_seq(),
            "type": self._normalize_msg_type(frame),
            "ts": frame.get("ts") or frame.get("deviceTs") or frame.get("device_ts") or now_iso(),
            "correlation_id": frame.get("correlationId") or frame.get("correlation_id"),
            "session_ref": frame.get("sessionRef") or frame.get("session_ref") or self.args.session_ref,
            "run_state": frame.get("runState") or frame.get("run_state"),
            "power_state": frame.get("powerState") or frame.get("power_state"),
            "alarm_codes": frame.get("alarmCodes") or frame.get("alarm_codes") or [],
            "cumulative_runtime_sec": frame.get("cumulativeRuntimeSec") or frame.get("cumulative_runtime_sec"),
            "cumulative_energy_wh": frame.get("cumulativeEnergyWh") or frame.get("cumulative_energy_wh"),
            "cumulative_flow": frame.get("cumulativeFlow") or frame.get("cumulative_flow"),
            "payload": self._build_payload(frame),
            "integrity": frame.get("integrity"),
        }

    def connect(self) -> dict[str, Any]:
        return self.client.post_json(
            "/bridge/connect",
            {
                "imei": self.args.imei,
                "bridge_id": self.bridge_id,
                "protocol_version": self.args.protocol_version,
                "remote_addr": self.args.port,
                "remote_port": self.args.baudrate,
            },
        )

    def heartbeat(self) -> dict[str, Any]:
        result = self.client.post_json(
            "/bridge/heartbeat",
            {
                "imei": self.args.imei,
                "bridge_id": self.bridge_id,
                "session_ref": self.args.session_ref,
                "device_ts": now_iso(),
                "remote_addr": self.args.port,
                "remote_port": self.args.baudrate,
                "dispatch_pending_commands": self.args.dispatch_pending_commands,
                "mark_sent": self.args.mark_sent,
                "include_sent": self.args.include_sent,
                "limit": self.args.limit,
                "payload": {
                    "bridge_kind": "serial_bridge",
                    "serial_port": self.args.port,
                    "baudrate": self.args.baudrate,
                },
            },
        )
        pending = result.get("pending_commands")
        if isinstance(pending, list) and self.args.dispatch_pending_commands:
            self.write_pending_commands([item for item in pending if isinstance(item, dict)])
        return result

    def disconnect(self) -> dict[str, Any]:
        return self.client.post_json(
            "/bridge/disconnect",
            {
                "imei": self.args.imei,
                "bridge_id": self.bridge_id,
                "connection_id": f"bridge:{self.bridge_id}:{self.args.imei}",
            },
        )

    def write_pending_commands(self, commands: list[dict[str, Any]]) -> None:
        if not commands or self.serial_port is None:
            return
        for command in commands:
            wire_message = command.get("wire_message")
            if isinstance(wire_message, dict):
                outbound = dict(wire_message)
            else:
                outbound = {
                    "protocol": self.args.protocol_version,
                    "type": command.get("command_code"),
                    "imei": command.get("imei"),
                    "msg_id": command.get("request_msg_id") or str(uuid.uuid4()),
                    "seq": command.get("request_seq_no") or self._next_seq(),
                    "correlation_id": command.get("command_token"),
                    "session_ref": command.get("session_ref"),
                    "payload": command.get("request_payload") or {},
                }
            outbound["bridge_origin"] = "backend_serial_bridge"
            self.serial_port.write((json.dumps(outbound, ensure_ascii=False) + "\n").encode("utf-8"))

    def read_frame(self) -> dict[str, Any] | None:
        if self.serial_port is None:
            return None
        raw = self.serial_port.readline()
        if not raw:
            return None
        try:
            text = raw.decode("utf-8").strip()
            if not text:
                return None
            parsed = json.loads(text)
        except Exception as exc:
            print(f"Invalid serial JSON frame ignored: {exc}", file=sys.stderr)
            return None
        if not isinstance(parsed, dict):
            print("Non-object serial frame ignored", file=sys.stderr)
            return None
        return parsed

    def ingest_frame(self, frame: dict[str, Any]) -> dict[str, Any] | None:
        msg_type = self._normalize_msg_type(frame)
        if msg_type in IGNORED_INBOUND_MSG_TYPES:
            return None
        if frame.get("bridge_origin") == "backend_serial_bridge":
            return None
        return self.client.post_json("/runtime-events", self._build_envelope(frame))

    def run(self) -> int:
        self.install_signal_handlers()
        self.open_serial()
        try:
            print(json.dumps({"bridge": "connect", "result": self.connect()}, ensure_ascii=False))
            print(json.dumps({"bridge": "heartbeat", "result": self.heartbeat()}, ensure_ascii=False))

            if self.args.once:
                return 0

            next_heartbeat_at = time.monotonic() + self.args.heartbeat_interval_seconds
            while not self.stopping:
                frame = self.read_frame()
                if frame is not None:
                    result = self.ingest_frame(frame)
                    if result is not None:
                        print(json.dumps({"bridge": "ingest", "result": result}, ensure_ascii=False))
                if time.monotonic() >= next_heartbeat_at:
                    print(json.dumps({"bridge": "heartbeat", "result": self.heartbeat()}, ensure_ascii=False))
                    next_heartbeat_at = time.monotonic() + self.args.heartbeat_interval_seconds
        finally:
            try:
                print(json.dumps({"bridge": "disconnect", "result": self.disconnect()}, ensure_ascii=False))
            except Exception as exc:
                print(f"Bridge disconnect failed: {exc}", file=sys.stderr)
            self.close_serial()
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serial bridge for backend device-gateway HTTP bridge.")
    parser.add_argument("--port", required=True, help="COM port or pyserial URL such as COM3 or loop://")
    parser.add_argument("--baudrate", type=int, default=115200, help="Serial baudrate")
    parser.add_argument("--imei", required=True, help="Registered device IMEI")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:3000/api/v1/ops/device-gateway",
        help="Backend device-gateway base URL",
    )
    parser.add_argument("--bridge-id", default=None, help="Optional bridge id override")
    parser.add_argument("--protocol-version", default="hj-device-v2", help="Bridge protocol version")
    parser.add_argument("--session-ref", default=None, help="Optional sessionRef override")
    parser.add_argument("--heartbeat-interval-seconds", type=float, default=15.0, help="Heartbeat interval")
    parser.add_argument("--read-timeout", type=float, default=0.5, help="Serial read timeout in seconds")
    parser.add_argument("--write-timeout", type=float, default=1.0, help="Serial write timeout in seconds")
    parser.add_argument("--http-timeout", type=float, default=10.0, help="HTTP timeout in seconds")
    parser.add_argument("--seq-start", type=int, default=1, help="Starting sequence number")
    parser.add_argument("--limit", type=int, default=20, help="Max pending commands returned per heartbeat")
    parser.add_argument("--include-sent", action="store_true", help="Include already-sent commands in bridge heartbeat result")
    parser.add_argument("--no-mark-sent", dest="mark_sent", action="store_false", help="Do not mark pending commands as sent")
    parser.add_argument(
        "--no-dispatch-pending",
        dest="dispatch_pending_commands",
        action="store_false",
        help="Heartbeat only updates bridge state and does not request pending commands",
    )
    parser.add_argument("--once", action="store_true", help="Connect, heartbeat once, disconnect, then exit")
    parser.set_defaults(mark_sent=True, dispatch_pending_commands=True)
    return parser


def main() -> int:
    load_local_env()
    args = build_parser().parse_args()
    return SerialGatewayBridge(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
