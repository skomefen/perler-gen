@echo off
rem ─────────────────────────────────────────────────────────────
rem  清理测试残留：以管理员身份运行本文件即可删掉那三个目录。
rem  它们是之前跑无头 Chrome 测试时留下的临时浏览器配置，
rem  跟拼豆程序本身没有任何关系，删掉不影响使用。
rem ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

echo.
echo 正在清理测试残留目录...
echo.

for %%d in (_ct2 _ct3 _ctest) do (
  if exist "%%d" (
    echo   删除 %%d ...
    rd /s /q "%%d" 2>nul
    if exist "%%d" (
      echo     [失败] %%d 仍被系统句柄占用
    ) else (
      echo     [成功] %%d 已删除
    )
  ) else (
    echo   %%d 不存在，跳过
  )
)

echo.
echo 剩余的测试残留目录：
set FOUND=0
for %%d in (_ct2 _ct3 _ctest) do (
  if exist "%%d" (
    echo   - %%d
    set FOUND=1
  )
)
if "%FOUND%"=="0" echo   无，已全部清理干净
echo.
echo 如果仍有残留，重启电脑后再运行一次即可（僵尸句柄会随重启释放）。
echo.
pause
