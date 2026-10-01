@echo off
cd /d "%~dp0"
set "ACAI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%ACAI_NODE%" (
  "%ACAI_NODE%" server.cjs
) else (
  node server.cjs
)
pause
