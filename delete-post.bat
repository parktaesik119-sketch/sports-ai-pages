@echo off
set /p filename="삭제할 파일명을 입력하세요 (예: 26-05-12-team.md): "
del src\content\posts\%filename%
git add .
git commit -m "포스팅 삭제: %filename%"
git push origin main
echo 삭제 완료 및 깃허브 전송됨!
pause