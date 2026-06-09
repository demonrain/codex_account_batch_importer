from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, request
import base64
import cgi
import io
import json
import os
import queue
import threading
import time


CODEX_HEALTH_URL = os.environ.get(
    "CODEX_HEALTH_URL",
    "https://chatgpt.com/backend-api/codex/responses",
)
CODEX_USER_AGENT = os.environ.get(
    "CODEX_USER_AGENT",
    "codex_cli_rs/0.125.0 (Ubuntu 22.4.0; x86_64) xterm-256color",
)
CODEX_TEST_MODEL = os.environ.get("CODEX_TEST_MODEL", "gpt-5.4")


class Handler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == "/health-check":
            self.handle_health_check()
            return
        if self.path.startswith("/proxy-upload/"):
            self.handle_proxy_upload()
            return
        if self.path.startswith("/proxy/"):
            self.handle_proxy_json()
            return
        return super().do_POST()

    def handle_proxy_json(self):
        target_base = self.read_target_base()
        if not target_base:
            return

        target_path = self.path[len("/proxy") :]
        target_url = target_base + target_path
        body = self.read_body()
        headers = self.collect_auth_headers({"Content-Type": self.headers.get("Content-Type", "application/json")})

        req = request.Request(target_url, data=body, headers=headers, method="POST")
        self.forward_request(req)

    def handle_proxy_upload(self):
        target_base = self.read_target_base()
        if not target_base:
            return

        body, content_type = self.rebuild_multipart_body()
        target_path = self.path[len("/proxy-upload") :]
        target_url = target_base + target_path
        headers = self.collect_auth_headers({"Content-Type": content_type})

        req = request.Request(target_url, data=body, headers=headers, method="POST")
        self.forward_request(req)

    def read_target_base(self):
        target_base = self.headers.get("x-import-target", "").strip().rstrip("/")
        if not target_base:
            self.write_json(400, {"message": "missing x-import-target"})
            return None
        return target_base

    def collect_auth_headers(self, base_headers):
        headers = dict(base_headers)
        auth = self.headers.get("Authorization")
        api_key = self.headers.get("x-api-key")
        if auth:
            headers["Authorization"] = auth
        if api_key:
            headers["x-api-key"] = api_key
        return headers

    def forward_request(self, req):
        try:
            with request.urlopen(req, timeout=120) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(payload)
        except error.HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self.send_cors_headers()
            self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json"))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            self.write_json(502, {"message": str(exc)})

    def rebuild_multipart_body(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise ValueError("multipart/form-data required")

        environ = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": content_type,
            "CONTENT_LENGTH": str(int(self.headers.get("Content-Length", "0") or "0")),
        }
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ=environ,
            keep_blank_values=True,
        )

        boundary = f"----codex-proxy-{int(time.time() * 1000)}"
        buffer = io.BytesIO()

        fields = form.list or []
        for field in fields:
            if not getattr(field, "filename", None):
                continue
            filename = os.path.basename(field.filename)
            payload = field.file.read()
            buffer.write(f"--{boundary}\r\n".encode("utf-8"))
            buffer.write(
                f'Content-Disposition: form-data; name="{field.name}"; filename="{filename}"\r\n'.encode("utf-8")
            )
            buffer.write(b"Content-Type: application/json\r\n\r\n")
            buffer.write(payload)
            buffer.write(b"\r\n")

        buffer.write(f"--{boundary}--\r\n".encode("utf-8"))
        return buffer.getvalue(), f"multipart/form-data; boundary={boundary}"

    def handle_health_check(self):
        try:
            payload = json.loads(self.read_body().decode("utf-8") or "{}")
        except Exception as exc:
            self.write_json(400, {"message": f"invalid json: {exc}"})
            return

        accounts = payload.get("accounts")
        if not isinstance(accounts, list):
            self.write_json(400, {"message": "accounts must be an array"})
            return

        concurrency = payload.get("concurrency", 3)
        if not isinstance(concurrency, int) or concurrency <= 0:
            concurrency = 3
        concurrency = max(1, min(concurrency, 8))

        started = time.time()
        items = run_health_checks(accounts, concurrency)
        ok = sum(1 for item in items if item.get("status") == "ok")
        bad = len(items) - ok
        self.write_json(
            200,
            {
                "total": len(items),
                "ok": ok,
                "bad": bad,
                "duration_ms": int((time.time() - started) * 1000),
                "items": items,
            },
        )

    def read_body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-import-target")

    def write_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run_health_checks(accounts, concurrency):
    work_queue = queue.Queue()
    results = [None] * len(accounts)
    for index, account in enumerate(accounts):
        work_queue.put((index, account))

    def worker():
        while True:
            try:
                index, account = work_queue.get_nowait()
            except queue.Empty:
                return
            try:
                results[index] = check_codex_account(account)
            finally:
                work_queue.task_done()

    threads = []
    for _ in range(min(concurrency, len(accounts))):
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        threads.append(thread)

    for thread in threads:
        thread.join()

    return [item for item in results if item is not None]


def check_codex_account(account):
    key = str(account.get("key") or "")
    file_name = str(account.get("file_name") or "")
    access_token = str(account.get("access_token") or "").strip()
    account_id = str(account.get("account_id") or "").strip()
    start = time.time()

    if not access_token:
        return health_item(key, file_name, "bad", "missing access token", start)

    exp_error = access_token_expiry_error(access_token)
    if exp_error:
        return health_item(key, file_name, "bad", exp_error, start)

    body = json.dumps(
        {
            "model": CODEX_TEST_MODEL,
            "input": [
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": "hi"}],
                }
            ],
            "stream": True,
            "store": False,
            "instructions": "You are a helpful assistant.",
        },
        ensure_ascii=False,
    ).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": "Bearer " + access_token,
        "User-Agent": CODEX_USER_AGENT,
        "OpenAI-Beta": "responses=experimental",
        "originator": "opencode",
    }
    if account_id:
        headers["chatgpt-account-id"] = account_id

    req = request.Request(CODEX_HEALTH_URL, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=45) as resp:
            if resp.status != 200:
                return health_item(key, file_name, "bad", f"HTTP {resp.status}", start)
            success, message = read_codex_stream_result(resp)
            if success:
                return health_item(key, file_name, "ok", "测活通过", start)
            return health_item(key, file_name, "bad", message or "上游未返回完成事件", start)
    except error.HTTPError as exc:
        detail = exc.read(4096).decode("utf-8", errors="replace")
        message = extract_error_message(detail) or f"HTTP {exc.code}"
        return health_item(key, file_name, "bad", message, start)
    except Exception as exc:
        return health_item(key, file_name, "bad", str(exc), start)


def health_item(key, file_name, status, message, start):
    return {
        "key": key,
        "file_name": file_name,
        "status": status,
        "message": message,
        "latency_ms": int((time.time() - start) * 1000),
    }


def access_token_expiry_error(token):
    parts = token.split(".")
    if len(parts) != 3:
        return ""
    try:
        payload = json.loads(base64url_decode(parts[1]).decode("utf-8"))
    except Exception:
        return ""
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and int(time.time()) > int(exp) + 120:
        return "access token expired"
    return ""


def base64url_decode(value):
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def read_codex_stream_result(resp):
    bytes_seen = 0
    while True:
        line = resp.readline(64 * 1024)
        if not line:
            return False, "response ended before completion"
        bytes_seen += len(line)
        if bytes_seen > 2 * 1024 * 1024:
            return False, "response too large before completion"
        text = line.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        if text.startswith("data:"):
            text = text[5:].strip()
        if text == "[DONE]":
            return True, ""
        try:
            event = json.loads(text)
        except Exception:
            continue
        event_type = str(event.get("type") or "")
        if event_type in ("response.completed", "response.done"):
            return True, ""
        if event_type in ("response.failed", "error"):
            return False, extract_stream_error(event) or "upstream returned error"


def extract_stream_error(event):
    if not isinstance(event, dict):
        return ""
    error_value = event.get("error")
    if isinstance(error_value, dict):
        return str(error_value.get("message") or error_value.get("code") or "").strip()
    if isinstance(error_value, str):
        return error_value.strip()
    response_value = event.get("response")
    if isinstance(response_value, dict):
        nested = response_value.get("error")
        if isinstance(nested, dict):
            return str(nested.get("message") or nested.get("code") or "").strip()
    return ""


def extract_error_message(text):
    try:
        data = json.loads(text)
    except Exception:
        return text.strip()[:500]
    if isinstance(data, dict):
        error_value = data.get("error")
        if isinstance(error_value, dict):
            return str(error_value.get("message") or error_value.get("code") or "").strip()
        if isinstance(error_value, str):
            return error_value.strip()
        for key in ("message", "detail"):
            if data.get(key):
                return str(data[key]).strip()
    return text.strip()[:500]


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5177), Handler)
    print("Account batch importer: http://127.0.0.1:5177")
    server.serve_forever()
