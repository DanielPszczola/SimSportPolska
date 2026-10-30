"""
Lokalny pre-prod: baza Supabase w Dockerze + podgląd strony. Uruchamiany przez preprod.bat.

    python tools/preprod.py start    -> baza (Docker) + strona na http://localhost:8000
    python tools/preprod.py stop     -> zatrzymuje lokalną bazę (dane zostają)
    python tools/preprod.py reset    -> czyści LOKALNĄ bazę i wgrywa dane startowe od nowa
    python tools/preprod.py status   -> adresy i klucze lokalnej bazy

Wymaga Docker Desktop. Supabase CLI pobiera się samo do tools/bin (bez Node.js).
Produkcja nie jest tu w ogóle używana: projekt nie jest „podlinkowany” z Supabase w chmurze,
więc żadne polecenie z tego skryptu nie może zmienić danych na produkcji.
"""
import io
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / 'tools' / 'bin'
LOCAL_CONFIG = ROOT / 'js' / 'config.local.js'
CLI_URL = 'https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz'
PORT = 8000

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def say(msg=''):
    print(msg, flush=True)


def fail(msg):
    say(f'\n[BŁĄD] {msg}')
    sys.exit(1)


# ---------- Docker ----------

def docker_state():
    """None = brak Dockera, False = zainstalowany, ale nie działa, True = gotowy."""
    exe = shutil.which('docker')
    if not exe:
        return None
    return subprocess.run([exe, 'info'], capture_output=True).returncode == 0


def ensure_docker():
    state = docker_state()
    if state:
        return
    desktop = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Docker' / 'Docker' / 'Docker Desktop.exe'
    if state is None and not desktop.exists():
        fail('Brak Dockera — lokalna baza Supabase działa w Dockerze.\n'
             '  1. Zainstaluj Docker Desktop: https://www.docker.com/products/docker-desktop/\n'
             '     (albo w terminalu: winget install Docker.DockerDesktop)\n'
             '  2. Uruchom go raz, zaakceptuj warunki i poczekaj, aż będzie gotowy (może poprosić o restart / WSL).\n'
             '  3. Uruchom preprod.bat ponownie.')
    say('Uruchamiam Docker Desktop…')
    subprocess.Popen([str(desktop)])
    for _ in range(120):
        time.sleep(2)
        if docker_state():
            return
    fail('Docker nie odpowiada. Otwórz Docker Desktop, poczekaj aż będzie gotowy i spróbuj ponownie.')


# ---------- Supabase CLI ----------

def ensure_cli():
    local = BIN / 'supabase.exe'
    if local.exists():
        return str(local)
    if shutil.which('supabase'):
        return shutil.which('supabase')
    say('Pobieram Supabase CLI (jednorazowo, ~40 MB)…')
    BIN.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(CLI_URL) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        member = next((m for m in tar.getmembers() if m.name.endswith('supabase.exe')), None)
        if not member:
            fail('W pobranym archiwum nie ma supabase.exe.')
        with tar.extractfile(member) as src, open(local, 'wb') as dst:
            dst.write(src.read())
    return str(local)


def cli(*args, capture=False):
    return subprocess.run([ensure_cli(), *args], cwd=ROOT, capture_output=capture, text=capture, encoding='utf-8' if capture else None)


def local_env():
    r = cli('status', '-o', 'env', capture=True)
    if r.returncode:
        return None
    env = {}
    for line in r.stdout.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"')
    return env


def write_local_config(env):
    url = env.get('API_URL', 'http://127.0.0.1:54321')
    key = env.get('PUBLISHABLE_KEY') or env.get('ANON_KEY')
    if not key:
        fail('Nie udało się odczytać klucza lokalnej bazy (supabase status).')
    LOCAL_CONFIG.write_text(
        "// Wygenerowane przez preprod.bat — strona uruchomiona LOKALNIE korzysta z LOKALNEJ bazy (Docker).\n"
        "// Plik nie trafia do repozytorium ani na serwer. Usuwa go „preprod.bat stop”.\n"
        f"export const SUPABASE_URL = '{url}';\n"
        f"export const SUPABASE_ANON_KEY = '{key}';\n",
        encoding='utf-8')


def info(env):
    studio = env.get('STUDIO_URL', 'http://127.0.0.1:54323')
    mail = env.get('INBUCKET_URL') or env.get('MAILPIT_URL') or 'http://127.0.0.1:54324'
    say()
    say('  ┌──────────────────────────────────────────────────────────────')
    say(f'  │ Strona (pre-prod):     http://localhost:{PORT}')
    say(f'  │ Panel bazy (Studio):   {studio}')
    say(f'  │ Poczta testowa:        {mail}')
    say( '  │ Admin strony:          login admin / hasło admin')
    say( '  │ Dane: kopia startowa (sezony F1 z seed.sql) — produkcja nietknięta')
    say('  └──────────────────────────────────────────────────────────────')
    say()


# ---------- polecenia ----------

def start():
    ensure_docker()
    say('Uruchamiam lokalną bazę Supabase… (za pierwszym razem Docker pobiera obrazy — kilka GB, kilka minut)')
    if cli('start').returncode:
        fail('Nie udało się uruchomić lokalnej bazy (komunikat powyżej).')
    env = local_env()
    if not env:
        fail('Baza wystartowała, ale nie udało się odczytać jej adresu (supabase status).')
    write_local_config(env)
    info(env)
    say('Strona działa w tym oknie — Ctrl+C zatrzymuje stronę (baza działa dalej; „preprod.bat stop” ją zatrzyma).')
    threading.Timer(1.5, lambda: webbrowser.open(f'http://localhost:{PORT}')).start()
    try:
        subprocess.call([sys.executable, str(ROOT / 'tools' / 'serve.py'), str(PORT)], cwd=ROOT)
    except KeyboardInterrupt:
        pass


def stop():
    if shutil.which('docker') and docker_state():
        cli('stop')
    if LOCAL_CONFIG.exists():
        LOCAL_CONFIG.unlink()
    say('Lokalna baza zatrzymana (dane zostają do następnego startu). Strona uruchamiana lokalnie znów korzysta z produkcji.')


def reset():
    ensure_docker()
    say('To wyczyści LOKALNĄ bazę (Docker) i wgra dane startowe od nowa. Produkcja nie zostanie zmieniona.')
    if input('Wpisz TAK, aby kontynuować: ').strip().upper() != 'TAK':
        say('Anulowano.')
        return
    if cli('db', 'reset').returncode:
        fail('Reset nie powiódł się (komunikat powyżej). Czy lokalna baza jest uruchomiona? (preprod.bat start)')
    say('Gotowe — lokalna baza ma świeże dane startowe.')


def status():
    ensure_docker()
    cli('status')
    env = local_env()
    if env:
        info(env)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'start'
    {'start': start, 'stop': stop, 'reset': reset, 'status': status}.get(cmd, lambda: fail(f'Nieznane polecenie: {cmd}'))()
