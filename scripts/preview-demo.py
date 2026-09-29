#!/usr/bin/env python3
"""Serve the exact Pages artifact under a repository subpath, with no API proxy."""
import argparse,http.server,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=4173);p.add_argument('--prefix',default='/Pi_Control/');a=p.parse_args()
root=Path(__file__).resolve().parents[1]/'frontend/dist-demo';prefix='/'+a.prefix.strip('/')+'/'
if not (root/'index.html').exists():raise SystemExit('Run npm --prefix frontend run build:demo first.')
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def do_GET(self):
        path=urllib.parse.urlsplit(self.path).path
        if path==prefix[:-1]:self.send_response(301);self.send_header('Location',prefix);self.end_headers();return
        if not path.startswith(prefix):self.send_error(404);return
        self.path=self.path[len(prefix)-1:];super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'")
        super().end_headers()
print(f'Demo: http://127.0.0.1:{a.port}{prefix}',flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
