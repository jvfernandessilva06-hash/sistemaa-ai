@echo off
rem Abre o sistema numa janela propria, como aplicativo (sem barra de endereco nem abas).
rem Usa o Brave, o Edge ou o Chrome, o que achar primeiro. Sem nenhum deles, abre no navegador padrao.
set "ACAI_URL=http://localhost:3000"
rem Outro endereco pode vir como parametro (ex.: a copia de teste em http://localhost:3150).
if not "%~1"=="" set "ACAI_URL=%~1"
set "NAV="
for %%N in (
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do if not defined NAV if exist %%N set "NAV=%%~N"

if defined NAV (
  start "" "%NAV%" --app=%ACAI_URL% --start-maximized
) else (
  start "" %ACAI_URL%
)
