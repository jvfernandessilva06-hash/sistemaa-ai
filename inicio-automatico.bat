@echo off
rem Liga ou desliga a abertura automatica do sistema quando o Windows inicia.
rem Cria (ou remove) um atalho para o iniciar.bat na pasta Inicializar do usuario.
cd /d "%~dp0"
set "ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Sistema Acai.lnk"

if exist "%ATALHO%" (
  del "%ATALHO%"
  echo Inicio automatico DESLIGADO. O sistema nao abre mais sozinho com o Windows.
  echo Para usar, de dois cliques no iniciar.bat.
) else (
  powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ATALHO); $s.TargetPath = (Join-Path (Get-Location) 'iniciar.bat'); $s.WorkingDirectory = (Get-Location).Path; $s.IconLocation = (Join-Path (Get-Location) 'icone.ico') + ',0'; $s.WindowStyle = 7; $s.Description = 'Sistema Acai PDV'; $s.Save()"
  if exist "%ATALHO%" (
    echo Inicio automatico LIGADO. Toda vez que o computador ligar, o sistema abre sozinho.
    echo Para desligar, de dois cliques neste arquivo de novo.
  ) else (
    echo Nao foi possivel criar o atalho. Tente executar este arquivo de novo.
  )
)
echo.
pause
