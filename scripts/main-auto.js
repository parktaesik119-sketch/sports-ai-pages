// scripts/main-auto.js
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runAutomation() {
  console.log("====================================================");
  console.log("🚀 [픽천국] 일일 통합 자동화 시스템을 시작합니다.");
  console.log("====================================================");

  try {
    // 1단계: 데이터 수집 
    console.log("\n[1단계] 전 종목 경기 데이터 수집 중...");
    execSync('node fetch-all.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ 데이터 수집 및 마스터 DB 업데이트 완료.");

    // 2~5단계: 분석 및 마크다운 생성
    // (analyze-gemini.js 내부에서 필터링, H2H 추출, AI 분석, MD 생성이 모두 처리됨)
    console.log("\n[2-5단계] 신규 경기 필터링 및 AI 분석 시작...");
    console.log("💡 이미 생성된 분석글은 자동으로 건너뜁니다.");
    execSync('node analyze-router-one-git.js', { stdio: 'inherit', cwd: __dirname });
    
    console.log("\n====================================================");
    console.log("🎉 모든 작업이 완료되었습니다!");
    console.log("📍 생성된 MD 파일 위치: src/content/posts/");
    console.log("👉 이제 이 폴더의 파일들을 업로드용 PC로 복사하세요.");
    console.log("====================================================");

  } catch (error) {
    console.error("\n❌ 자동화 실행 중 오류 발생:");
    console.error(error.message);
  }
}

runAutomation();