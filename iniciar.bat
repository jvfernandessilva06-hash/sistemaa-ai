@echo off
cd /d "%~dp0"
title Sistema Acai - nao feche esta janela

rem Se o sistema ja estiver rodando, so abre a janela.
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:3000/api/me -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  call abrir-janela.bat
  exit /b
)

rem Abre a janela do sistema (como aplicativo) depois que o servidor sobe.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & call abrir-janela.bat"

set "ACAI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%ACAI_NODE%" set "ACAI_NODE=node"

rem Se o servidor parar por algum erro, ele volta sozinho.
:inicio
"%ACAI_NODE%" server.cjs
echo.
echo O sistema parou. Reiniciando em 5 segundos... (feche esta janela para encerrar)
timeout /t 5 /nobreak >nul
goto inicio
