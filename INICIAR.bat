@echo off
chcp 65001 >nul
title Crmdss
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  start "" https://nodejs.org/pt-br/download
  pause
  exit /b
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEV=%%v
if %NODEV% LSS 24 (
  echo.
  echo  Seu Node.js e antigo. O Crmdss precisa da versao 24 ou mais nova.
  echo  Atualize em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo  Primeira vez: instalando os componentes. Leva 1 ou 2 minutos...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  Nao foi possivel instalar. Verifique a internet e tente de novo.
    pause
    exit /b
  )
)

echo.
echo  Crmdss rodando em http://localhost:3090
echo  Login: admin@lente.local   Senha: admin123
echo  Para desligar, feche esta janela.
echo.
start "" http://localhost:3090
node server.js
pause
