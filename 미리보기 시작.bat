@echo off
chcp 65001 >nul
echo.
echo   미리보기를 켰어요. 잠시 후 브라우저가 열려요.
echo   주소: http://localhost:5500
echo.
echo   이 검은 창을 닫으면 미리보기도 꺼져요.
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5500/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0.claude\serve.ps1"
