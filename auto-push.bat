@echo off
cd /d %~dp0

echo [1/3] Saving local changes first...
git add .
:: 혹시 변경사항이 없을 때 에러로 멈추는 걸 방지하기 위해 || exit /b 0 처리
git commit -m "auto update" || echo No changes to commit.

echo [2/3] Pulling latest from GitHub...
:: 내 커밋 뒤에 서버 내용을 안전하게 붙입니다.
git pull origin main --rebase

echo [3/3] Pushing to GitHub...
git push origin main

echo All tasks completed!
timeout /t 3