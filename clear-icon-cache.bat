@echo off
echo 正在清理 Windows 图标缓存...
echo.

REM 结束 Windows 资源管理器进程
taskkill /f /im explorer.exe

REM 删除图标缓存文件
cd /d %userprofile%\AppData\Local\Microsoft\Windows\Explorer
attrib -h iconcache_*.db
del iconcache_*.db /f /q

REM 删除旧版图标缓存（如果存在）
cd /d %userprofile%\AppData\Local
attrib -h IconCache.db
del IconCache.db /f /q 2>nul

echo.
echo 图标缓存已清理完成！
echo 正在重启资源管理器...
echo.

REM 重启资源管理器
start explorer.exe

echo.
echo 完成！请重新安装应用查看新图标。
pause
