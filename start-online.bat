@echo off
chcp 65001 >nul
title คลังวิธีแก้ปัญหา HIS (ออนไลน์)
cd /d "%~dp0"
rem เปิด Server แล้วสร้างลิงก์ https ให้ทีมเปิดจากที่ไหนก็ได้ ผ่าน Cloudflare Tunnel (ฟรี)

where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้งจาก https://nodejs.org แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)

set NEED_INSTALL=
if not exist "node_modules\express\package.json" set NEED_INSTALL=1
if not exist "node_modules\exceljs\package.json" set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo กำลังติดตั้งครั้งแรก รอสักครู่...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ติดตั้งไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วเปิดไฟล์นี้ใหม่
    pause
    exit /b 1
  )
)

set CF=
where cloudflared >nul 2>nul && set CF=cloudflared
if not defined CF if exist "%~dp0cloudflared.exe" set CF="%~dp0cloudflared.exe"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set CF="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set CF="%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF (
  echo ยังไม่มีโปรแกรม cloudflared กำลังติดตั้งให้ด้วย winget...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set CF="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
  if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set CF="%ProgramFiles%\cloudflared\cloudflared.exe"
)
if not defined CF (
  echo ติดตั้ง cloudflared ไม่สำเร็จ ดาวน์โหลด cloudflared-windows-amd64.exe จาก
  echo https://github.com/cloudflare/cloudflared/releases/latest
  echo เปลี่ยนชื่อเป็น cloudflared.exe แล้ววางไว้ในโฟลเดอร์เดียวกับไฟล์นี้ แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3000
rem cookies only over https, since teammates reach the site through the https link
set COOKIE_SECURE=1
start "HIS-KB Server" cmd /k node --disable-warning=ExperimentalWarning server.js

echo.
echo ================================================================
echo  รอสักครู่ ลิงก์สำหรับทีมจะขึ้นด้านล่าง หน้าตาแบบนี้
echo    https://xxxx-xxxx-xxxx.trycloudflare.com
echo  ส่งลิงก์นั้นให้ทีม ลิงก์ใช้ได้จนกว่าจะปิดหน้าต่างนี้
echo  เปิดใหม่ครั้งหน้าจะได้ลิงก์ใหม่ ต้องส่งให้ทีมอีกครั้ง
echo  ปิดหน้าต่างนี้ = ปิดลิงก์ / ปิดหน้าต่าง HIS-KB Server = ปิดเว็บ
echo ================================================================
echo.
%CF% tunnel --no-autoupdate --url http://localhost:%PORT%
pause
