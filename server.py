"""
Bridge Digital Twin - Local Server
Run with: python server.py
Then open: http://localhost:8000
"""

import http.server
import socketserver
import os

PORT = 8000

class BridgeHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.glb'):  return 'model/gltf-binary'
        if path.endswith('.gltf'): return 'model/gltf+json'
        return super().guess_type(path)

    def log_message(self, format, *args):
        status = str(args[1]) if len(args) > 1 else ''
        path = args[0].split()[1] if args and isinstance(args[0], str) and len(args[0].split()) > 1 else getattr(self, 'path', '')
        icon   = '✓' if status == '200' else '✗'
        print(f'  {icon}  [{status}] {path}')

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print('─' * 42)
print('  Bridge Digital Twin — Local Server')
print('─' * 42)
print(f'  Folder : {os.getcwd()}')
print(f'  URL    : http://localhost:{PORT}')
print('─' * 42)
print('  Ctrl+C to stop\n')

with socketserver.TCPServer(('', PORT), BridgeHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
