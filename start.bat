@echo off
chcp 65001 >nul
title คลังวิธีแก้ปัญหา HIS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้งจาก https://nodejs.org ^(เลือกรุ่น LTS^) แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js ต้องเป็นรุ่น 22.13 ขึ้นไป ตอนนี้เป็นรุ่น
  node -v
  echo กรุณาอัปเดต Node.js จาก https://nodejs.org แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)

set NEED_INSTALL=
if not exist "node_modules\express\package.json" set NEED_INSTALL=1
if not exist "node_modules\exceljs\package.json" set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo กำลังติดตั้งครั้งแรก รอสักครู่...
  if exist node_modules rmdir /s /q node_modules
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ติดตั้งไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วเปิดไฟล์นี้ใหม่
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"
node --disable-warning=ExperimentalWarning server.js
echo.
pause
