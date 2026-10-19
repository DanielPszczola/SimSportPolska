"""
Lokalny podgląd strony z wyłączonym cache przeglądarki (po każdej zmianie plików
przeglądarka zawsze pobiera aktualne wersje modułów JS).

    python tools/serve.py          -> http://localhost:8000
    python tools/serve.py 8642     -> inny port
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webp': 'image/webp'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # konsola Windows (cp1252) a polskie znaki
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    # "" = wszystkie interfejsy, więc działa zarówno http://localhost, jak i http://127.0.0.1
    with http.server.ThreadingHTTPServer(('', PORT), handler) as srv:
        print(f'Podgląd: http://localhost:{PORT}  (Ctrl+C kończy)')
        srv.serve_forever()
