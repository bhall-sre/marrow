#!/usr/bin/env python3
"""Static server for tools/smoke.html.

http.server sends no Cache-Control, so browsers apply heuristic freshness and will keep
running a stale copy of a module you just fixed -- which makes the smoke test report an
error that no longer exists. This sends no-store on everything.

Usage:  python tools/serve.py [port]
"""
import functools, http.server, os, socketserver, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port),
                                functools.partial(Handler, directory=ROOT)) as httpd:
        print(f"serving {ROOT} at http://localhost:{port}/tools/smoke.html")
        httpd.serve_forever()
