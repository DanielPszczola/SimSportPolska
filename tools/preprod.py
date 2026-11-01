"""
Lokalny pre-prod: baza Supabase w Dockerze + podgląd strony. Uruchamiany przez preprod.bat.

    python tools/preprod.py start    -> baza (Docker) + strona na http://localhost:8000
    python tools/preprod.py stop     -> zatrzymuje lokalną bazę (dane zostają)
    python tools/preprod.py reset    -> czyści LOKALNĄ bazę i wgrywa dane startowe od nowa
    python tools/preprod.py status   -> adresy i klucze lokalnej bazy
    python tools/preprod.py login [owner|admin|moderator|user|guest]
                                     -> otwiera stronę zalogowaną jako wybrany typ użytkownika (konta testowe)

Wymaga Docker Desktop. Supabase CLI pobiera się samo do tools/bin (bez Node.js).
Produkcja nie jest tu w ogóle używana: projekt nie jest „podlinkowany” z Supabase w chmurze,
więc żadne polecenie z tego skryptu nie może zmienić danych na produkcji.
"""
import io
import os
import re
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

# konta testowe lokalnej bazy (supabase/local/admin.sql i users.sql): typ -> (login, hasło, strona po zalogowaniu, opis)
LOGINS = {
    'owner': ('admin', 'admin', '#/admin', 'konto główne (pełny dostęp)'),
    'admin': ('test-admin', 'test', '#/admin', 'administrator'),
    'moderator': ('test-mod', 'test', '#/admin', 'moderator (bez rang i kont Discord)'),
    'user': ('test-discord', 'test', '#/konto', 'zwykły użytkownik zalogowany przez Discord'),
    'guest': (None, None, '#/', 'gość — wylogowany'),
}
LOCAL_SQL = [ROOT / 'supabase' / 'schema.sql', ROOT / 'supabase' / 'local' / 'admin.sql', ROOT / 'supabase' / 'local' / 'users.sql']

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
    logins = ''.join(f"  {kind}: ['{login}', '{pw}', '{page}'],\n" for kind, (login, pw, page, _) in LOGINS.items() if login)
    LOCAL_CONFIG.write_text(
        "// Wygenerowane przez preprod.bat — strona uruchomiona LOKALNIE korzysta z LOKALNEJ bazy (Docker).\n"
        "// Plik nie trafia do repozytorium ani na serwer. Usuwa go „preprod.bat stop”.\n"
        f"export const SUPABASE_URL = '{url}';\n"
        f"export const SUPABASE_ANON_KEY = '{key}';\n"
        "// konta testowe lokalnej bazy — „preprod.bat login <typ>” otwiera #/preprod/<typ>\n"
        f"export const PREPROD_LOGINS = {{\n{logins}}};\n",
        encoding='utf-8')


def db_container():
    m = re.search(r'^project_id\s*=\s*"([^"]+)"', (ROOT / 'supabase' / 'config.toml').read_text(encoding='utf-8'), re.M)
    return f"supabase_db_{m.group(1) if m else ROOT.name}"


def update_local_db():
    """Aktualny schemat (supabase/schema.sql — niczego nie kasuje) i konta testowe w LOKALNEJ bazie (Docker)."""
    for path in LOCAL_SQL:
        r = subprocess.run(['docker', 'exec', '-i', '-e', 'PGOPTIONS=--client-min-messages=warning', db_container(),
                            'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'],
                           input=path.read_bytes(), capture_output=True)
        if r.returncode:
            fail(f'Nie udało się wczytać {path.relative_to(ROOT)} do lokalnej bazy:\n{r.stderr.decode("utf-8", "replace")}')


def info(env):
    studio = env.get('STUDIO_URL', 'http://127.0.0.1:54323')
    mail = env.get('INBUCKET_URL') or env.get('MAILPIT_URL') or 'http://127.0.0.1:54324'
    say()
    say('  ┌──────────────────────────────────────────────────────────────')
    say(f'  │ Strona (pre-prod):     http://localhost:{PORT}')
    say(f'  │ Panel bazy (Studio):   {studio}')
    say(f'  │ Poczta testowa:        {mail}')
    say( '  │ Konta testowe (preprod.bat login <typ> loguje od razu):')
    for kind, (login, pw, _, desc) in LOGINS.items():
        if login:
            say(f'  │   {kind:<10} {login} / {pw:<6} — {desc}')
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
    say('Aktualizuję lokalną bazę (schema.sql + konta testowe)…')
    update_local_db()
    info(env)
    serve(f'http://localhost:{PORT}')


def site_running():
    try:
        urllib.request.urlopen(f'http://localhost:{PORT}/index.html', timeout=2)
        return True
    except Exception:
        return False


def serve(url):
    """Otwiera przeglądarkę i uruchamia podgląd strony w tym oknie."""
    say('Strona działa w tym oknie — Ctrl+C zatrzymuje stronę (baza działa dalej; „preprod.bat stop” ją zatrzyma).')
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    try:
        subprocess.call([sys.executable, str(ROOT / 'tools' / 'serve.py'), str(PORT)], cwd=ROOT)
    except KeyboardInterrupt:
        pass


def login(kind=None):
    if not kind:
        say()
        say('  Zaloguj na pre-prodzie jako:')
        kinds = list(LOGINS)
        for i, k in enumerate(kinds, 1):
            say(f'   {i}. {k:<10} — {LOGINS[k][3]}')
        pick = input(f'Wybierz [1-{len(kinds)}]: ').strip()
        kind = kinds[int(pick) - 1] if pick.isdigit() and 1 <= int(pick) <= len(kinds) else pick
    kind = {'mod': 'moderator', 'discord': 'user', 'uzytkownik': 'user', 'gosc': 'guest'}.get(kind, kind)
    if kind not in LOGINS:
        fail(f'Nieznany typ użytkownika: {kind}. Dostępne: {", ".join(LOGINS)}')
    ensure_docker()
    env = local_env()
    if not env:
        fail('Lokalna baza nie działa — uruchom najpierw: preprod.bat start')
    write_local_config(env)
    update_local_db()
    url = f'http://localhost:{PORT}/#/preprod/{kind}'
    login_name = LOGINS[kind][0]
    say(f'Pre-prod: {kind} — {LOGINS[kind][3]}' + (f' (login {login_name})' if login_name else ''))
    say(f'Adres: {url}')
    say('Sesja jest wspólna dla kart tej przeglądarki. Dwóch użytkowników naraz: wklej adres w oknie prywatnym (Ctrl+Shift+N).')
    if site_running():
        webbrowser.open(url)
    else:
        say('Podgląd strony nie działa — uruchamiam go w tym oknie.')
        serve(url)


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
    if cmd == 'login':
        login(sys.argv[2] if len(sys.argv) > 2 else None)
    else:
        {'start': start, 'stop': stop, 'reset': reset, 'status': status}.get(cmd, lambda: fail(f'Nieznane polecenie: {cmd}'))()
