@echo off
rem Copy this working folder to the folder registered in the browser (Vivaldi/Chrome).
rem Usage: deploy-ext.cmd [destination]   (default: C:\Claude\TubeFolio3-ext)
rem After copying, press "Reload" for TubeFolio3 at vivaldi://extensions
set "SRC=%~dp0"
set "DST=%~1"
if "%DST%"=="" set "DST=C:\Claude\TubeFolio3-ext"
robocopy "%SRC%." "%DST%" /MIR /XD .git .claude _metadata /XF CLAUDE.md deploy-ext.cmd /NFL /NDL /NJH /NP
if errorlevel 8 (
  echo Copy FAILED
  exit /b 1
)
echo Copy done: %DST%
exit /b 0
