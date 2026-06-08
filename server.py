from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error
import json


class Handler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-sub2api-target")
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/proxy/"):
            return super().do_POST()

        target_base = self.headers.get("x-sub2api-target", "").strip().rstrip("/")
        if not target_base:
            self.write_json(400, {"message": "missing x-sub2api-target"})
            return

        if not target_base.endswith("/api/v1"):
            target_base = target_base + "/api/v1"

        target_path = self.path[len("/proxy"):]
        target_url = target_base + target_path
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))

        headers = {
            "Content-Type": "application/json",
        }
        auth = self.headers.get("Authorization")
        api_key = self.headers.get("x-api-key")
        if auth:
            headers["Authorization"] = auth
        if api_key:
            headers["x-api-key"] = api_key

        req = request.Request(target_url, data=body, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=120) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(payload)
        except error.HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json"))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            self.write_json(502, {"message": str(exc)})

    def write_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5177), Handler)
    print("Sub2API account tool: http://127.0.0.1:5177")
    server.serve_forever()
