@echo off
cd /d "%~dp0"
rem Abre o sistema no navegador padrao depois que o servidor sobe.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
set "ACAI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%ACAI_NODE%" (
  "%ACAI_NODE%" server.cjs
) else (
  node server.cjs
)
pause
