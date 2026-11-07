@echo off
rem run-blitz.bat <scene> [tiles]
cd /d "%~dp0"
set scene=%1
if "%scene%"=="" set scene=getting-started
set tiles=%2
if "%tiles%"=="" set tiles=1
solenoid-blitz.exe view "scenes\%scene%" --tile %tiles% %3 %4
