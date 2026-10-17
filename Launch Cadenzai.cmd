@echo off
REM Double-click to open Cadenzai in its own window.
REM Starts the local server if needed, then opens the app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch\cadenzai-launcher.ps1"
