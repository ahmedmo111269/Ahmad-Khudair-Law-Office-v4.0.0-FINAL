from __future__ import annotations

import base64
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from pathlib import Path
from unittest.mock import patch

from sync_relay import CIPHER, FORMAT, RelayStore, make_server

TOKEN = "A" * 48
WORKSPACE = "workspace_test_1234567890"
ORIGIN = "https://office.test"


def encrypted_box(marker: str = "ciphertext"):
    # Authenticated-envelope structure only; tests the relay never decrypts package contents.
    return {
        "format": FORMAT,
        "version": 1,
        "cipher": CIPHER,
        "iv": base64.b64encode(b"i" * 12).decode("ascii"),
        "ciphertext": base64.b64encode((marker.encode("ascii") + b"x" * 16)).decode("ascii"),
    }


class SyncRelayHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "relay.sqlite3"
        self.server = make_server(
            host="127.0.0.1", port=0, database_path=str(self.db_path),
            tokens={WORKSPACE: {TOKEN}}, allowed_origins={ORIGIN},
        )
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, method, path, *, token=TOKEN, origin=ORIGIN, body=None):
        headers = {"Origin": origin, "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.base}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8")), dict(response.headers)
        except HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8")), dict(error.headers)

    def test_server_startup_requires_exact_https_origin_not_wildcard(self):
        with tempfile.TemporaryDirectory() as temp:
            path = str(Path(temp) / "unused.sqlite3")
            for origin in ("", "*", "https://office.test/path", "http://public.test"):
                with self.subTest(origin=origin), patch.dict(os.environ, {"AKL_SYNC_ALLOWED_ORIGINS": origin}):
                    with self.assertRaises(RuntimeError):
                        make_server(host="127.0.0.1", port=0, database_path=path, tokens={WORKSPACE: {TOKEN}})
            self.assertFalse(Path(path).exists())

    def test_public_health_is_protocol_versioned(self):
        status, body, headers = self.request("GET", "/v1/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["service"], "akl-sync-relay")
        self.assertEqual(body["protocolVersion"], 1)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_bearer_auth_is_required_and_scoped_to_workspace(self):
        path = f"/v1/relay/{WORKSPACE}/packages?after=0&limit=5"
        self.assertEqual(self.request("GET", path, token=None)[0], 401)
        self.assertEqual(self.request("GET", path, token="B" * 48)[0], 401)
        self.assertEqual(self.request("GET", "/v1/relay/not_provisioned_123456/packages?after=0&limit=5")[0], 401)

    def test_origin_allowlist_and_preflight(self):
        status, body, _ = self.request("GET", "/v1/health", token=None, origin="https://evil.test")
        self.assertEqual(status, 403)
        request = Request(
            f"{self.base}/v1/relay/{WORKSPACE}/packages",
            headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"},
            method="OPTIONS",
        )
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 204)
            self.assertIn("Authorization", response.headers["Access-Control-Allow-Headers"])

    def test_encrypted_package_upload_download_and_idempotency(self):
        path = f"/v1/relay/{WORKSPACE}/packages"
        body = {"packageId": "01ABCDEF234567890XYZ", "sealed": encrypted_box("only-ciphertext")}
        status, created, _ = self.request("POST", path, body=body)
        self.assertEqual(status, 201)
        self.assertTrue(created["created"])
        status, duplicate, _ = self.request("POST", path, body=body)
        self.assertEqual(status, 200)
        self.assertFalse(duplicate["created"])
        self.assertEqual(duplicate["cursor"], created["cursor"])
        status, page, _ = self.request("GET", path + "?after=0&limit=5")
        self.assertEqual(status, 200)
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["items"][0]["sealed"], body["sealed"])
        with sqlite3.connect(self.db_path) as db:
            stored = db.execute("SELECT sealed_json FROM packages").fetchone()[0]
        self.assertIn("only-ciphertext", base64.b64decode(json.loads(stored)["ciphertext"]).decode("ascii"))
        self.assertNotIn("sourceDeviceId", stored)
        self.assertNotIn("passphrase", stored)

    def test_cursor_pagination_is_monotonic_and_bounded(self):
        path = f"/v1/relay/{WORKSPACE}/packages"
        for number in range(7):
            status, _, _ = self.request("POST", path, body={"packageId": f"package{number:04d}", "sealed": encrypted_box(f"cipher{number}")})
            self.assertEqual(status, 201)
        status, first, _ = self.request("GET", path + "?after=0&limit=3")
        self.assertEqual(status, 200)
        self.assertEqual(len(first["items"]), 3)
        self.assertTrue(first["hasMore"])
        second_path = path + f"?after={first['nextCursor']}&limit=3"
        status, second, _ = self.request("GET", second_path)
        self.assertEqual(status, 200)
        self.assertEqual(len(second["items"]), 3)
        self.assertTrue(second["hasMore"])
        self.assertGreater(second["nextCursor"], first["nextCursor"])

    def test_invalid_or_oversized_envelopes_are_rejected(self):
        path = f"/v1/relay/{WORKSPACE}/packages"
        bad = {"packageId": "bad0001", "sealed": {"format": "plaintext", "version": 1}}
        self.assertEqual(self.request("POST", path, body=bad)[0], 400)
        bad_iv = {"packageId": "bad0002", "sealed": {**encrypted_box(), "iv": base64.b64encode(b"short").decode("ascii")}}
        self.assertEqual(self.request("POST", path, body=bad_iv)[0], 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
