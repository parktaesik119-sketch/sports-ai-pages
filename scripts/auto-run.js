// scripts/auto-run.js
import { execSync } from 'child_process';

try {
  console.log("1. 축구 데이터 수집 시작...");
  // 데이터 수집 파일 실행 (파일명이 다르면 수정하세요)
  execSync('node scripts/fetch-data.js', { stdio: 'inherit' });

  console.log("2. 그록 AI 분석 및 글 작성 시작...");
  // 분석 및 글쓰기 파일 실행
  execSync('node scripts/analyze-gemini.js', { stdio: 'inherit' });

  console.log("✅ 모든 작업이 완료되었습니다.");
} catch (error) {
  console.error("❌ 자동 실행 중 오류 발생:", error.message);
  process.exit(1);
}