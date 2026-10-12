#!/usr/bin/env python3
"""Small self-hosted encrypted package relay for the law-office offline sync engine.

The relay stores only AES-GCM ciphertext and a random package id/cursor. It never
receives a passphrase, CryptoKey, database row, or decrypted sync envelope.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

PROTOCOL_VERSION = 1
SERVICE_NAME = "akl-sync-relay"
WORKSPACE_RE = re.compile(r"^[A-Za-z0-9_-]{16,120}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9_-]{1,140}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9._~-]{32,512}$")
FORMAT = "AhmadKhudairLawOfficeRelayEncrypted"
CIPHER = "AES-256-GCM"
MAX_BODY_BYTES = 9 * 1024 * 1024
MAX_CIPHERTEXT_BYTES = 7 * 1024 * 1024
MAX_PAGE_SIZE = 10
RATE_LIMIT = 180
RATE_WINDOW_SECONDS = 60


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_tokens(raw: str | None = None) -> dict[str, set[str]]:
    value = raw if raw is not None else os.environ.get("AKL_SYNC_TOKENS", "")
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RuntimeError("AKL_SYNC_TOKENS must be a JSON object mapping workspace IDs to token arrays.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("AKL_SYNC_TOKENS must be a JSON object.")
    result: dict[str, set[str]] = {}
    for workspace, tokens in parsed.items():
        workspace = str(workspace)
        if not WORKSPACE_RE.fullmatch(workspace):
            raise RuntimeError(f"Invalid sync workspace ID in AKL_SYNC_TOKENS: {workspace!r}")
        if isinstance(tokens, str):
            tokens = [tokens]
        if not isinstance(tokens, list) or not tokens:
            raise RuntimeError(f"Workspace {workspace} must have at least one bearer token.")
        clean = set()
        for token in tokens:
            token = str(token)
            if not TOKEN_RE.fullmatch(token):
                raise RuntimeError(f"A token for workspace {workspace} must be 32-512 URL-safe characters.")
            clean.add(token)
        result[workspace] = clean
    return result


def validate_origins(origins: set[str]) -> set[str]:
    if not origins or "*" in origins:
        raise RuntimeError("Set AKL_SYNC_ALLOWED_ORIGINS to an explicit HTTPS origin; wildcard CORS is not accepted.")
    for origin in origins:
        parsed = urlsplit(origin)
        host = (parsed.hostname or "").lower()
        local = host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost")
        try:
            parsed.port
        except ValueError as exc:
            raise RuntimeError(f"Invalid allowed origin {origin!r}; the port is not valid.") from exc
        if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise RuntimeError(f"Invalid allowed origin {origin!r}; use an exact HTTPS origin without a path.")
    return origins


def validate_sealed(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("sealed must be an encrypted envelope object")
    if value.get("format") != FORMAT or int(value.get("version", 0)) != 1 or value.get("cipher") != CIPHER:
        raise ValueError("unsupported encrypted envelope")
    try:
        iv = base64.b64decode(str(value.get("iv", "")), validate=True)
        ciphertext = base64.b64decode(str(value.get("ciphertext", "")), validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid encrypted envelope encoding") from exc
    if len(iv) != 12 or len(ciphertext) < 16 or len(ciphertext) > MAX_CIPHERTEXT_BYTES:
        raise ValueError("encrypted envelope size is outside accepted bounds")
    return {"format": FORMAT, "version": 1, "cipher": CIPHER, "iv": value["iv"], "ciphertext": value["ciphertext"]}


class RelayStore:
    def __init__(self, database_path: str | Path):
        self.path = str(database_path)
        if self.path != ":memory:":
            Path(self.path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._init()

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level="IMMEDIATE", check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _init(self):
        with self.lock, self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("""CREATE TABLE IF NOT EXISTS packages (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT NOT NULL,
                package_id TEXT NOT NULL,
                sealed_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, package_id)
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS packages_workspace_cursor ON packages(workspace_id, cursor)")

    def insert(self, workspace_id: str, package_id: str, sealed: dict) -> tuple[int, bool]:
        payload = json.dumps(sealed, separators=(",", ":"), ensure_ascii=True)
        with self.lock, self.connect() as db:
            row = db.execute("SELECT cursor FROM packages WHERE workspace_id=? AND package_id=?", (workspace_id, package_id)).fetchone()
            if row:
                return int(row["cursor"]), False
            cursor = db.execute(
                "INSERT INTO packages(workspace_id,package_id,sealed_json,created_at) VALUES(?,?,?,?)",
                (workspace_id, package_id, payload, utc_now()),
            ).lastrowid
            return int(cursor), True

    def list_after(self, workspace_id: str, after: int, limit: int):
        with self.lock, self.connect() as db:
            rows = db.execute(
                "SELECT cursor,sealed_json,created_at FROM packages WHERE workspace_id=? AND cursor>? ORDER BY cursor ASC LIMIT ?",
                (workspace_id, after, limit + 1),
            ).fetchall()
            has_more = len(rows) > limit
            rows = rows[:limit]
            total = db.execute("SELECT COUNT(*) FROM packages WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        items = [{"cursor": int(row["cursor"]), "sealed": json.loads(row["sealed_json"]), "createdAt": row["created_at"]} for row in rows]
        next_cursor = items[-1]["cursor"] if items else after
        return {"items": items, "nextCursor": next_cursor, "hasMore": has_more, "total": int(total)}

    def count(self, workspace_id: str) -> int:
        with self.lock, self.connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM packages WHERE workspace_id=?", (workspace_id,)).fetchone()[0])


class RelayHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, *, store, tokens, allowed_origins):
        super().__init__(address, handler)
        self.store = store
        self.tokens = tokens
        self.allowed_origins = allowed_origins
        self.rate_lock = threading.Lock()
        self.rate_buckets = defaultdict(deque)

    def check_rate(self, key: str) -> bool:
        now = time.monotonic()
        with self.rate_lock:
            bucket = self.rate_buckets[key]
            while bucket and bucket[0] <= now - RATE_WINDOW_SECONDS:
                bucket.popleft()
            if len(bucket) >= RATE_LIMIT:
                return False
            bucket.append(now)
            return True


class RelayHandler(BaseHTTPRequestHandler):
    server: RelayHTTPServer
    protocol_version = "HTTP/1.1"
    server_version = "AKLRelay"
    sys_version = ""

    def log_message(self, fmt, *args):
        # Avoid Authorization, request bodies, workspace IDs, and full request paths in logs.
        status = args[1] if len(args) > 1 else "-"
        print(f"[{utc_now()}] {self.client_address[0]} {self.command} status={status}")

    def _origin_headers(self):
        origin = self.headers.get("Origin", "")
        allow = self.server.allowed_origins
        if "*" in allow:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin and origin in allow:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, status: int, payload: dict, *, extra_headers: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._origin_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _path(self):
        return urlsplit(self.path)

    def _check_origin(self):
        origin = self.headers.get("Origin", "")
        allow = self.server.allowed_origins
        if origin and "*" not in allow and origin not in allow:
            self._send(403, {"error": "origin_not_allowed"})
            return False
        return True

    def _workspace(self, path: str):
        match = re.fullmatch(r"/v1/relay/([^/]+)/packages", path)
        if not match:
            return None
        workspace = unquote(match.group(1))
        return workspace if WORKSPACE_RE.fullmatch(workspace) else None

    def _authenticate(self, workspace: str):
        configured = self.server.tokens.get(workspace, set())
        auth = self.headers.get("Authorization", "")
        supplied = auth[7:].strip() if auth.startswith("Bearer ") else ""
        if not supplied or not TOKEN_RE.fullmatch(supplied) or not configured:
            return False
        supplied_hash = hashlib.sha256(supplied.encode("utf-8")).digest()
        return any(hmac.compare_digest(supplied_hash, hashlib.sha256(candidate.encode("utf-8")).digest()) for candidate in configured)

    def _authorized_workspace(self):
        workspace = self._workspace(self._path().path)
        if workspace is None:
            self._send(404, {"error": "not_found"})
            return None
        if not self._authenticate(workspace):
            self._send(401, {"error": "unauthorized"})
            return None
        return workspace

    def _body(self):
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdigit():
            raise ValueError("content_length_required")
        length = int(raw_length)
        if length < 1 or length > MAX_BODY_BYTES:
            raise OverflowError("body_too_large")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("incomplete_body")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid_json") from exc
        if not isinstance(value, dict):
            raise ValueError("json_object_required")
        return value

    def do_OPTIONS(self):
        if not self._check_origin():
            return
        self.send_response(204)
        self._origin_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        if not self._check_origin():
            return
        parsed = self._path()
        address = self.client_address[0]
        if not self.server.check_rate(address):
            self._send(429, {"error": "rate_limited"}, extra_headers={"Retry-After": "30"})
            return
        if parsed.path == "/v1/health":
            self._send(200, {"service": SERVICE_NAME, "protocolVersion": PROTOCOL_VERSION, "status": "ok"})
            return
        workspace = self._authorized_workspace()
        if workspace is None:
            return
        try:
            query = parse_qs(parsed.query, strict_parsing=False)
            after = int(query.get("after", ["0"])[0])
            limit = int(query.get("limit", ["40"])[0])
            if after < 0 or after > 9_007_199_254_740_991 or limit < 1 or limit > MAX_PAGE_SIZE:
                raise ValueError
        except (ValueError, TypeError):
            self._send(400, {"error": "invalid_cursor_or_limit"})
            return
        self._send(200, self.server.store.list_after(workspace, after, limit))

    def do_POST(self):
        if not self._check_origin():
            return
        if not self.server.check_rate(self.client_address[0]):
            self._send(429, {"error": "rate_limited"}, extra_headers={"Retry-After": "30"})
            return
        workspace = self._authorized_workspace()
        if workspace is None:
            return
        try:
            body = self._body()
            package_id = str(body.get("packageId", ""))
            if not PACKAGE_RE.fullmatch(package_id):
                raise ValueError("invalid_package_id")
            sealed = validate_sealed(body.get("sealed"))
        except OverflowError:
            self.close_connection = True
            self._send(413, {"error": "body_too_large"})
            return
        except (ValueError, TypeError) as exc:
            self.close_connection = True
            self._send(400, {"error": str(exc)[:120]})
            return
        cursor, created = self.server.store.insert(workspace, package_id, sealed)
        self._send(201 if created else 200, {"cursor": cursor, "created": created})

    def handle_one_request(self):
        try:
            return super().handle_one_request()
        except (ConnectionError, TimeoutError, OSError):
            self.close_connection = True


def make_server(host: str | None = None, port: int | None = None, database_path: str | None = None,
                tokens: dict[str, set[str]] | None = None, allowed_origins: set[str] | None = None):
    host = host or os.environ.get("AKL_SYNC_HOST", "127.0.0.1")
    port = int(port if port is not None else os.environ.get("AKL_SYNC_PORT", "8787"))
    database_path = database_path or os.environ.get("AKL_SYNC_DB", "./data/relay.sqlite3")
    tokens = load_tokens() if tokens is None else tokens
    origins_raw = os.environ.get("AKL_SYNC_ALLOWED_ORIGINS", "")
    allowed_origins = ({origin.strip() for origin in origins_raw.split(",") if origin.strip()} if allowed_origins is None else set(allowed_origins))
    if not tokens:
        raise RuntimeError("Set AKL_SYNC_TOKENS to a JSON mapping of workspace IDs to bearer tokens before starting the relay.")
    validate_origins(allowed_origins)
    store = RelayStore(database_path)
    return RelayHTTPServer((host, port), RelayHandler, store=store, tokens=tokens, allowed_origins=allowed_origins)


def main():
    server = make_server()
    print(f"{SERVICE_NAME} protocol {PROTOCOL_VERSION} listening on {server.server_address[0]}:{server.server_address[1]}")
    print("Place a TLS reverse proxy in front of this service. The SQLite file contains encrypted packages and must not be web-accessible.")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
