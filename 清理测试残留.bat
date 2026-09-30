@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
rem =============================================================
rem  Clean up test leftovers.
rem
rem  The _ct* folders are temporary browser profiles left behind
rem  by the headless-Chrome test runs. They have nothing to do
rem  with the perler app itself and are safe to delete.
rem
rem  Usage: just double-click this file.
rem  Admin rights are normally NOT needed. Only use
rem  "Run as administrator" if it says the folder is in use.
rem =============================================================
cd /d "%~dp0"

set "DIRS=_ct2 _ct3 _ctest"

echo.
echo   正在清理测试残留目录...
echo.

rem Close any headless Chrome still holding these folders.
rem Only kills processes whose command line mentions _ct,
rem so your own browser windows are left alone.
set "KILLED=0"
for /f "skip=1 tokens=1" %%p in ('wmic process where "name='chrome.exe'" get processid^,commandline 2^>nul ^| findstr /i "_ct"') do (
  taskkill /f /pid %%p >nul 2>&1
  set "KILLED=1"
)
if "!KILLED!"=="1" (
  echo   已关闭占用这些目录的测试用 Chrome 进程
  ping -n 3 127.0.0.1 >nul 2>&1
)

for %%d in (%DIRS%) do (
  if exist "%%d" (
    rd /s /q "%%d" >nul 2>&1
    if exist "%%d" (
      echo   [失败] %%d 仍被占用
    ) else (
      echo   [成功] %%d 已删除
    )
  ) else (
    echo   [跳过] %%d 不存在
  )
)

echo.
rem Re-check with !FOUND! (delayed expansion). Writing %FOUND% here
rem would expand at parse time and always report success, which is
rem exactly why the old version of this script looked useless.
set "FOUND=0"
for %%d in (%DIRS%) do (
  if exist "%%d" (
    echo   仍残留： %%d
    set "FOUND=1"
  )
)

if "!FOUND!"=="0" (
  echo   全部清理干净。
) else (
  echo.
  echo   有目录没能删掉，通常是句柄还没释放：
  echo     1^) 关掉所有 Chrome / Edge 窗口后再运行一次
  echo     2^) 仍不行就重启电脑后再运行
  echo     3^) 还不行就右键本文件，以管理员身份运行
)

echo.
pause
