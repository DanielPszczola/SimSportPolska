@echo off
rem Lokalny pre-prod: baza Supabase w Dockerze + podglad strony (http://localhost:8000).
rem Uzycie: preprod.bat [start | stop | reset | status | login [owner|admin|moderator|user|guest]]  (bez parametru - menu)
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Pythona. Zainstaluj go z https://www.python.org/downloads/ ^(zaznacz "Add python.exe to PATH"^).
  pause
  exit /b 1
)

if not "%~1"=="" (
  python tools\preprod.py %*
  goto :end
)

echo.
echo  Sim Sport Polska - lokalny pre-prod
echo  -----------------------------------
echo   1. Start  - baza w Dockerze + strona na http://localhost:8000
echo   2. Stop   - zatrzymaj lokalna baze (dane zostaja)
echo   3. Reset  - wyczysc LOKALNA baze i wgraj dane startowe od nowa
echo   4. Status - adresy i klucze lokalnej bazy
echo   5. Login  - otworz strone zalogowana jako: owner / admin / moderator / user / guest
echo.
choice /c 12345 /n /m "Wybierz [1-5]: "
if errorlevel 5 python tools\preprod.py login & goto :end
if errorlevel 4 python tools\preprod.py status & goto :end
if errorlevel 3 python tools\preprod.py reset & goto :end
if errorlevel 2 python tools\preprod.py stop & goto :end
python tools\preprod.py start

:end
pause
