@echo off
rem Double-click this file to start My Animator.
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing building blocks, this takes a few minutes...
  call npm install
)
call npm run app
if errorlevel 1 pause
