@echo off
cd /d %~dp0

echo [1/3] Retrieving latest DB...
git pull origin main --rebase

echo [2/3] Saving changes...
git add .
git commit -m "auto update"

echo [3/3] Pushing to GitHub...
git push origin main

echo All tasks completed!
timeout /t 3