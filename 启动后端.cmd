@echo off
cd /d "%~dp0server"
if not exist node_modules\express (
  call npm ci
  if errorlevel 1 exit /b 1
)
call npm start
pause
