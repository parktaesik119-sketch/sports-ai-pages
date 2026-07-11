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
    // 0단계: 전날 캐시 파일 정리 (당일 파일/누적 DB는 보존)
    console.log("\n[0단계] 전날 database 캐시 파일 정리 중...");
    execSync('node cleanup-database.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ DB 정리 완료.");

    // 1단계: 데이터 수집 
    console.log("\n[1단계] 전 종목 경기 데이터 수집 중...");
    execSync('node fetch-all.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ 데이터 수집 및 마스터 DB 업데이트 완료.");

    // 1.5단계: 배구 스코어 업데이트
    console.log("\n[1.5단계] 배구 스코어 업데이트 중...");
    execSync('node fetch-score-update.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ 배구 스코어 업데이트 완료.");

    // 1.6단계: SofaScore H2H/최근폼/배당/라인업(포메이션)/선수사진 수집
    // (축구/농구/배구/하키 - 리그별 스크립트들보다 먼저 실행해 폭넓은 기반 데이터부터 채운다)
    console.log("\n[1.6단계] SofaScore H2H/최근폼/배당/라인업 데이터 수집 중...");
    execSync('node fetch-sofascore-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ SofaScore 컨텍스트 수집 완료.");

    // 1.7단계: ESPN 결장자/순위/H2H 컨텍스트 수집
    console.log("\n[1.7단계] ESPN 결장자/순위/H2H 데이터 수집 중...");
    execSync('node fetch-espn-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ ESPN 컨텍스트 수집 완료.");

    // 1.8단계: KBO 선발투수/구종/라인업/순위 컨텍스트 수집 (ESPN 미커버 리그)
    console.log("\n[1.8단계] KBO 선발투수/구종/라인업 데이터 수집 중...");
    execSync('node fetch-kbo-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ KBO 컨텍스트 수집 완료.");

    // 1.9단계: NPB 예고선발투수 컨텍스트 수집 (ESPN 미커버 리그)
    console.log("\n[1.9단계] NPB 예고선발투수 데이터 수집 중...");
    execSync('node fetch-npb-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ NPB 컨텍스트 수집 완료.");

    // 1.95단계: KBL 최근폼/상대전적 컨텍스트 수집 (ESPN 미커버 리그, 겨울 시즌제)
    console.log("\n[1.95단계] KBL 최근폼/상대전적 데이터 수집 중...");
    execSync('node fetch-kbl-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ KBL 컨텍스트 수집 완료.");

    // 1.96단계: UEFA 챔스/컨퍼런스리그 컨텍스트 수집 (예선전은 ESPN 라인업 커버리지 부실)
    console.log("\n[1.96단계] UEFA 챔스/컨퍼런스리그 데이터 수집 중...");
    execSync('node fetch-uefa-context.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ UEFA 컨텍스트 수집 완료.");

    // 2~5단계: 분석 및 마크다운 생성
    console.log("\n[2-5단계] 신규 경기 필터링 및 AI 분석 시작...");
    console.log("💡 이미 생성된 분석글은 자동으로 건너뜁니다.");
    execSync('node analyze-router-one-git.js', { stdio: 'inherit', cwd: __dirname });
    
    // 6단계: 링크 삽입
    console.log("\n[6단계] 분석글 링크 삽입 중...");
    execSync('node inject-links.js', { stdio: 'inherit', cwd: __dirname });
    console.log("✅ 링크 삽입 완료.");

    console.log("\n====================================================");
    console.log("🎉 모든 작업이 완료되었습니다!");
    console.log("📍 생성된 MD 파일 위치: src/content/posts/");
    console.log("====================================================");

  } catch (error) {
    console.error("\n❌ 자동화 실행 중 오류 발생:");
    console.error(error.message);
  }
}

runAutomation();