@echo off
title Filtrsoft Crawls
REM ===========================================================================
REM  One button. Double-click to stop every Filtrsoft crawl on this machine;
REM  double-click again to start them.
REM
REM  It flips a flag at %USERPROFILE%\.filtrsoft\paused, which BOTH schedules
REM  read before doing anything:
REM    · the agent loop  (Startup folder, polls every 15s, 45-min auto-crawl)
REM    · the 10:00 task  (Filtrsoft Daily Crawl, runs daily.ts directly)
REM  Pausing also closes any crawl browser that is already open.
REM
REM  WHY THE FULL PATH TO BUN: this runs from a desktop shortcut with whatever
REM  PATH Explorer hands it, which is not the PATH a terminal gets. `bun` alone
REM  works when tested from a shell and fails silently on a double-click, and a
REM  switch that silently does nothing is worse than no switch at all. Same
REM  reason agent.cmd and daily.cmd spell it out.
REM ===========================================================================
cd /d "C:\Dev\filtrsoft"

set BUN=C:\Users\yzger\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-aarch64\bun.exe
if not exist "%BUN%" set BUN=bun

"%BUN%" run src/scripts/pause.ts %*
if errorlevel 1 (
  echo.
  echo   Could not reach bun at:
  echo     %BUN%
  echo   Open a terminal in C:\Dev\filtrsoft and run: bun run pause
  echo.
)

REM A moment to read the state, then close itself. No keypress needed --
REM this is a button, and a button that demands "press any key" is a dialog.
timeout /t 4 /nobreak > nul
