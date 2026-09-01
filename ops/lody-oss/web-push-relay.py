#!/usr/bin/env python3
"""Same-origin Web Push relay for Lody OSS.

nginx cookie-gates /push/*. This process only binds loopback. It stores
browser PushSubscriptions and forwards messages published to the local
ntfy topic so Safari / iOS Home Screen apps can wake without OneSignal.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

LISTEN_HOST = os.environ.get("LODY_WEB_PUSH_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("LODY_WEB_PUSH_PORT", "8096"))
CONFIG_PATH = Path(os.environ.get("LODY_OSS_CONFIG", "/etc/lody-oss/config.json"))
VAPID_PATH = Path(os.environ.get("LODY_WEB_PUSH_VAPID", "/etc/lody-oss/web-push-vapid.json"))
STORE_PATH = Path(os.environ.get("LODY_WEB_PUSH_STORE", "/var/lib/lody-oss/web-push/subscriptions.json"))
NTFY_BASE = os.environ.get("LODY_NTFY_BASE", "http://127.0.0.1:8094").rstrip("/")
VAPID_MAIL = os.environ.get("LODY_WEB_PUSH_MAILTO", "mailto:lody-oss@localhost")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def load_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def generate_vapid() -> dict[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    public_numbers = key.public_key().public_numbers()
    x = public_numbers.x.to_bytes(32, "big")
    y = public_numbers.y.to_bytes(32, "big")
    public_key = b64url(b"\x04" + x + y)
    return {"publicKey": public_key, "privatePem": private_pem}


def ensure_vapid() -> dict[str, str]:
    existing = load_json(VAPID_PATH, None)
    if (
        isinstance(existing, dict)
        and isinstance(existing.get("publicKey"), str)
        and isinstance(existing.get("privatePem"), str)
    ):
        return existing
    generated = generate_vapid()
    write_json(VAPID_PATH, generated)
    return generated


def ntfy_topic() -> str:
    config = load_json(CONFIG_PATH, {})
    topic = config.get("ntfy", {}).get("topic") if isinstance(config, dict) else None
    if not isinstance(topic, str) or not topic.strip():
        raise RuntimeError(f"ntfy.topic missing from {CONFIG_PATH}")
    return topic.strip()


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()

    def all(self) -> list[dict[str, Any]]:
        with self.lock:
            value = load_json(self.path, [])
            return value if isinstance(value, list) else []

    def upsert(self, subscription: dict[str, Any]) -> None:
        endpoint = subscription.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint.startswith("https://"):
            raise ValueError("invalid endpoint")
        keys = subscription.get("keys")
        if not isinstance(keys, dict):
            raise ValueError("invalid keys")
        if not isinstance(keys.get("p256dh"), str) or not isinstance(keys.get("auth"), str):
            raise ValueError("invalid keys")
        record = {
            "endpoint": endpoint,
            "expirationTime": subscription.get("expirationTime"),
            "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
            "id": hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
        }
        with self.lock:
            items = load_json(self.path, [])
            if not isinstance(items, list):
                items = []
            items = [item for item in items if item.get("endpoint") != endpoint]
            items.append(record)
            write_json(self.path, items)

    def remove(self, endpoint: str) -> None:
        with self.lock:
            items = load_json(self.path, [])
            if not isinstance(items, list):
                return
            write_json(self.path, [item for item in items if item.get("endpoint") != endpoint])


VAPID = ensure_vapid()
STORE = Store(STORE_PATH)


def send_web_push(subscription: dict[str, Any], payload: dict[str, str]) -> None:
    webpush(
        subscription_info={
            "endpoint": subscription["endpoint"],
            "keys": subscription["keys"],
        },
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=VAPID["privatePem"],
        vapid_claims={"sub": VAPID_MAIL},
        ttl=300,
    )


def dispatch_ntfy_message(message: dict[str, Any]) -> None:
    if message.get("event") not in (None, "message"):
        return
    body = message.get("message")
    title = message.get("title")
    payload = {
        "title": title if isinstance(title, str) and title.strip() else "Lody OSS",
        "body": body if isinstance(body, str) else "",
        "url": message.get("click") if isinstance(message.get("click"), str) else "/",
        "tag": "lody-oss",
    }
    stale: list[str] = []
    for subscription in STORE.all():
        try:
            send_web_push(subscription, payload)
        except WebPushException as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            if status in {404, 410}:
                stale.append(str(subscription.get("endpoint") or ""))
    for endpoint in stale:
        if endpoint:
            STORE.remove(endpoint)


def ntfy_loop() -> None:
    topic = ntfy_topic()
    url = f"{NTFY_BASE}/{urllib.parse.quote(topic, safe='')}/json"
    delay = 1.0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                delay = 1.0
                for raw in response:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict):
                        dispatch_ntfy_message(parsed)
        except Exception:
            time.sleep(delay)
            delay = min(delay * 2, 30.0)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send(self, status: int, body: dict[str, Any] | None = None) -> None:
        payload = b"" if body is None else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > 16_384:
            raise ValueError("invalid body")
        parsed = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("invalid body")
        return parsed

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/vapid-public-key":
            self._send(200, {"publicKey": VAPID["publicKey"]})
            return
        self._send(404, {"error": "not_found"})

    def do_PUT(self) -> None:
        if self.path.split("?", 1)[0] != "/subscription":
            self._send(404, {"error": "not_found"})
            return
        try:
            STORE.upsert(self._read_json())
        except ValueError as error:
            self._send(400, {"error": str(error)})
            return
            self._send(204, None)

    def do_DELETE(self) -> None:
        if self.path.split("?", 1)[0] != "/subscription":
            self._send(404, {"error": "not_found"})
            return
        try:
            body = self._read_json()
            endpoint = body.get("endpoint")
            if not isinstance(endpoint, str):
                raise ValueError("invalid endpoint")
        except ValueError as error:
            self._send(400, {"error": str(error)})
            return
        STORE.remove(endpoint)
        self._send(204, None)


def main() -> None:
    threading.Thread(target=ntfy_loop, name="ntfy-web-push", daemon=True).start()
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
