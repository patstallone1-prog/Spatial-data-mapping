"""Local-only persistent-browser migration fixture; production assets are unchanged."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
LEGACY = """
const CACHE='kerbside-0123456789abcdef';
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;
 e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});
"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "docs"), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        special = {
            "/__cache_qa__.html": ((ROOT / "tools/cache_qa.html").read_bytes(), "text/html"),
            "/__legacy_cache_qa__.js": (LEGACY.encode(), "text/javascript"),
            "/__cache_qa_data__.json": (b'{"revision":"network"}', "application/json"),
        }
        if path in special:
            body, content_type = special[path]
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Service-Worker-Allowed", "/")
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8901), Handler).serve_forever()
