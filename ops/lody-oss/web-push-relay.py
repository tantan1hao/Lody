#!/usr/bin/env python3
"""Same-origin Web Push relay for Lody OSS.

nginx cookie-gates /push/*. This process only binds loopback. It stores
browser PushSubscriptions and forwards messages published to the local
ntfy topic so Safari / iOS Home Screen apps can wake without OneSignal.

Uses stdlib + the operator host's cryptography (no pywebpush / pip).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDFExpand

LISTEN_HOST = os.environ.get("LODY_WEB_PUSH_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("LODY_WEB_PUSH_PORT", "8096"))
CONFIG_PATH = Path(os.environ.get("LODY_OSS_CONFIG", "/etc/lody-oss/config.json"))
VAPID_PATH = Path(os.environ.get("LODY_WEB_PUSH_VAPID", "/etc/lody-oss/web-push-vapid.json"))
STORE_PATH = Path(os.environ.get("LODY_WEB_PUSH_STORE", "/var/lib/lody-oss/web-push/subscriptions.json"))
NTFY_BASE = os.environ.get("LODY_NTFY_BASE", "http://127.0.0.1:8094").rstrip("/")
VAPID_MAIL = os.environ.get("LODY_WEB_PUSH_MAILTO", "mailto:lody-oss@localhost")

_VAPID: dict[str, str] | None = None


class WebPushGone(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f"subscription gone ({status})")
        self.status = status


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padded = value + ("=" * ((4 - len(value) % 4) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


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


def uncompressed_point(public_key: ec.EllipticCurvePublicKey) -> bytes:
    numbers = public_key.public_numbers()
    return b"\x04" + numbers.x.to_bytes(32, "big") + numbers.y.to_bytes(32, "big")


def public_from_uncompressed(raw: bytes) -> ec.EllipticCurvePublicKey:
    if len(raw) != 65 or raw[0] != 4:
        raise ValueError("invalid p256dh")
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)


def generate_vapid() -> dict[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return {"publicKey": b64url(uncompressed_point(key.public_key())), "privatePem": private_pem}


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


def vapid() -> dict[str, str]:
    global _VAPID
    if _VAPID is None:
        _VAPID = ensure_vapid()
    return _VAPID


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


STORE = Store(STORE_PATH)


def hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    return HKDFExpand(algorithm=hashes.SHA256(), length=length, info=info).derive(prk)


# RFC 8291 §3.4 / RFC 8188 info strings. Do not reuse the older aesgcm
# "Content-Encoding: aesgcm" / "P-256" labels — those are a different coding.
WEB_PUSH_INFO = b"WebPush: info\x00"
CEK_INFO = b"Content-Encoding: aes128gcm\x00"
NONCE_INFO = b"Content-Encoding: nonce\x00"
RECORD_SIZE = 4096


def encrypt_aes128gcm(
    plaintext: bytes,
    ua_public_raw: bytes,
    auth_secret: bytes,
    *,
    salt: bytes | None = None,
    as_private: ec.EllipticCurvePrivateKey | None = None,
) -> bytes:
    if as_private is None:
        as_private = ec.generate_private_key(ec.SECP256R1())
    as_public_raw = uncompressed_point(as_private.public_key())
    ecdh_secret = as_private.exchange(ec.ECDH(), public_from_uncompressed(ua_public_raw))
    # HKDF-Extract(salt=auth_secret, IKM=ecdh_secret)
    # HKDF-Expand(..., info="WebPush: info" || 0x00 || ua_public || as_public, 32)
    ikm = hkdf_expand(hkdf_extract(auth_secret, ecdh_secret), WEB_PUSH_INFO + ua_public_raw + as_public_raw, 32)
    if salt is None:
        salt = os.urandom(16)
    # RFC 8188: HKDF-Extract(salt, IKM) then Expand for CEK / nonce.
    prk = hkdf_extract(salt, ikm)
    cek = hkdf_expand(prk, CEK_INFO, 16)
    nonce = hkdf_expand(prk, NONCE_INFO, 12)
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", b"")
    return salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public_raw)]) + as_public_raw + ciphertext


def load_vapid_private_key(pem: str | None = None) -> ec.EllipticCurvePrivateKey:
    key = serialization.load_pem_private_key((pem or vapid()["privatePem"]).encode("ascii"), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise ValueError("VAPID key must be ECDSA P-256")
    return key


def vapid_jwt(endpoint: str, private_key: ec.EllipticCurvePrivateKey | None = None) -> str:
    parsed = urllib.parse.urlparse(endpoint)
    audience = f"{parsed.scheme}://{parsed.netloc}"
    header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode("utf-8"))
    payload = b64url(
        json.dumps(
            {"aud": audience, "exp": int(time.time()) + 12 * 3600, "sub": VAPID_MAIL},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    key = private_key or load_vapid_private_key()
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    return f"{header}.{payload}.{b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def send_web_push(subscription: dict[str, Any], payload: dict[str, str]) -> None:
    endpoint = str(subscription["endpoint"])
    keys = subscription["keys"]
    body = encrypt_aes128gcm(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        b64url_decode(str(keys["p256dh"])),
        b64url_decode(str(keys["auth"])),
    )
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"vapid t={vapid_jwt(endpoint)},k={vapid()['publicKey']}",
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": "300",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    except urllib.error.HTTPError as error:
        try:
            error.read()
        except Exception:
            pass
        if error.code in {404, 410}:
            raise WebPushGone(error.code) from error
        raise


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
        except WebPushGone:
            stale.append(str(subscription.get("endpoint") or ""))
        except Exception:
            continue
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
            self._send(200, {"publicKey": vapid()["publicKey"]})
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


def rfc8291_selftest() -> None:
    """Deterministic RFC 8291 §5 / Appendix A vector. No network."""
    plaintext = b"When I grow up, I want to be a watermelon"
    ua_public = b64url_decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
    auth_secret = b64url_decode("BTBZMqHH6r4Tts7J_aSIgg")
    salt = b64url_decode("DGv6ra1nlYgDCS1FRnbzlw")
    as_private = ec.derive_private_key(
        int.from_bytes(b64url_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"),
        ec.SECP256R1(),
    )
    as_public = uncompressed_point(as_private.public_key())
    expected_as_public = b64url_decode(
        "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    )
    if as_public != expected_as_public:
        raise SystemExit("VAPID/ECE selftest: application-server public key mismatch")
    body = encrypt_aes128gcm(plaintext, ua_public, auth_secret, salt=salt, as_private=as_private)
    expected = b64url_decode(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
        "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )
    if body != expected:
        raise SystemExit("VAPID/ECE selftest: RFC 8291 aes128gcm ciphertext mismatch")
    jwt_key = generate_vapid()
    private_key = load_vapid_private_key(jwt_key["privatePem"])
    token = vapid_jwt("https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV", private_key)
    header_b64, payload_b64, sig_b64 = token.split(".")
    claims = json.loads(b64url_decode(payload_b64))
    if claims.get("aud") != "https://push.example.net" or claims.get("sub") != VAPID_MAIL:
        raise SystemExit("VAPID/ECE selftest: JWT claims")
    sig = b64url_decode(sig_b64)
    private_key.public_key().verify(
        encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")),
        f"{header_b64}.{payload_b64}".encode("ascii"),
        ec.ECDSA(hashes.SHA256()),
    )
    if b64url(uncompressed_point(private_key.public_key())) != jwt_key["publicKey"]:
        raise SystemExit("VAPID/ECE selftest: publicKey encoding")
    print("rfc8291_selftest: ok")


def main() -> None:
    vapid()
    threading.Thread(target=ntfy_loop, name="ntfy-web-push", daemon=True).start()
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        rfc8291_selftest()
    else:
        main()
