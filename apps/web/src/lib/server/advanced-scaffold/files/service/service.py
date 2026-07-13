"""service.py — EDIT THIS FILE. A mock dependency the student program talks to.

In `service` network mode the platform starts this container alongside the run
container and injects its address into the run container as $NOJV_SERVICE_HOST.
The run (student) container reaches it over an internal-only network; it has no
direct internet route, so this service is the only peer it can call.

The service is TRUSTED (you authored it) but network-isolated. Bake every
dependency into the image at build time. It runs ONLY during the run phase and
never sees the answers.

CONTRACT: print the exact marker `NOJV_SERVICE_READY` to stdout once you are
listening. The platform polls for that line before it starts the run container,
so the student program never races a not-yet-ready service.
"""

import http.server
import json
import os
import socketserver

# The platform injects PORT=8888 and reaches the service on that port. A custom
# service MUST listen on $PORT (the run container only ever connects there).
PORT = int(os.environ.get("PORT", "8888"))

# The marker the platform waits for. Print it AFTER bind/listen succeeds.
READY_MARKER = "NOJV_SERVICE_READY"


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # --- EDIT HERE: your mock endpoints --------------------------------
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        elif self.path.startswith("/echo"):
            self._send(200, {"path": self.path})
        else:
            self._send(404, {"error": "not found"})
        # -------------------------------------------------------------------

    def log_message(self, *args):
        pass  # quiet the default per-request logging


def main():
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        # Signal readiness only after the socket is bound and listening.
        print(READY_MARKER, flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
