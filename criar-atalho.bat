@echo off
rem Cria (ou recria) o atalho "Delicias Acai" na area de trabalho, com o icone do logo.
rem O atalho liga o sistema e abre a janela dele; o servidor fica minimizado na barra de tarefas.
cd /d "%~dp0"
powershell -NoProfile -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Delicias Acai.lnk')); $s.TargetPath = (Join-Path (Get-Location) 'iniciar.bat'); $s.WorkingDirectory = (Get-Location).Path; $s.IconLocation = (Join-Path (Get-Location) 'icone.ico') + ',0'; $s.WindowStyle = 7; $s.Description = 'Sistema Delicias Acai PDV'; $s.Save(); if (Test-Path (Join-Path $d 'Delicias Acai.lnk')) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Nao foi possivel criar o atalho. Tente executar este arquivo de novo.
) else (
  echo Atalho "Delicias Acai" criado na area de trabalho.
)
echo.
pause
