@echo off
cd /d %~dp0

echo [1/3] 서버에서 최신 데이터 가져오는 중...
git pull origin main --rebase

echo [2/3] 변경 사항 저장 중...
git add .
git commit -m "auto update"

echo [3/3] 깃허브로 푸쉬 중...
git push origin main

echo 모든 작업이 완료되었습니다!
pause