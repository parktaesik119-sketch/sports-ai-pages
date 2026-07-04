// scripts/cleanup-database.js
// database/ 폴더에 매일 쌓이는 날짜별 파일을 정리합니다. all-fixtures.json 같은
// 누적 마스터 DB는 건드리지 않습니다.
//
// 보존 기준:
// - api-sports 원본 일정 파일(YYYY-MM-DD.json): 최근 3일(D-0~D-2)까지 보존, D-3부터 삭제
// - espn/kbo/npb-context-YYYY-MM-DD.json: 당일 것만 보존 (매일 새로 수집되는 캐시라 하루만 필요)
//
// 실행 시점: 매일 자동화 맨 앞(fetch-all.js보다 먼저)에서 돌려야
// "오늘 새로 받은 파일"이 정리 대상에 안 걸립니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DB_DIR = path.resolve(__dirname, '../database');

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

// KST 기준으로 n일 전 날짜(YYYY-MM-DD) 계산
function daysAgoKst(n) {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kstNow.setUTCDate(kstNow.getUTCDate() - n);
  return kstNow.toISOString().split('T')[0];
}

// api-sports 원본 일정 파일: "YYYY-MM-DD.json" (컨텍스트 파일과 구분하기 위해 접두어 없음)
const PLAIN_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

// 당일 것만 보존하는 컨텍스트 파일들
const TODAY_ONLY_PATTERNS = [
  /^espn-context-(\d{4}-\d{2}-\d{2})\.json$/,
  /^kbo-context-(\d{4}-\d{2}-\d{2})\.json$/,
  /^npb-context-(\d{4}-\d{2}-\d{2})\.json$/,
];

function extractTodayOnlyDate(filename) {
  for (const pattern of TODAY_ONLY_PATTERNS) {
    const m = filename.match(pattern);
    if (m) return m[1];
  }
  return null;
}

function main() {
  console.log('🧹 [DB 정리] 시작\n');

  const today = getKstToday();
  const cutoffDate = daysAgoKst(2); // D-0, D-1, D-2까지 보존 → D-3(cutoff보다 이전)부터 삭제

  if (!fs.existsSync(DB_DIR)) {
    console.log(`⚠️ database 폴더 없음: ${DB_DIR}`);
    return;
  }

  const files = fs.readdirSync(DB_DIR);
  let deletedCount = 0;
  let keptCount = 0;

  for (const file of files) {
    // 1) api-sports 원본 일정 파일: D-3 보존 정책
    const plainMatch = file.match(PLAIN_DATE_PATTERN);
    if (plainMatch) {
      const fileDate = plainMatch[1]; // 'YYYY-MM-DD' 문자열은 그대로 사전순 비교 가능
      if (fileDate >= cutoffDate) {
        keptCount++;
        continue; // 최근 3일 이내 → 보존
      }
      const fullPath = path.join(DB_DIR, file);
      try {
        fs.unlinkSync(fullPath);
        console.log(`🗑️  삭제(D-3 초과): ${file}`);
        deletedCount++;
      } catch (err) {
        console.error(`❌ 삭제 실패: ${file} -`, err.message);
      }
      continue;
    }

    // 2) espn/kbo/npb 컨텍스트 파일: 당일만 보존 정책 (기존과 동일)
    const contextDate = extractTodayOnlyDate(file);
    if (!contextDate) continue; // 날짜 패턴이 아닌 파일(all-fixtures.json 등)은 건드리지 않음

    if (contextDate === today) {
      keptCount++;
      continue;
    }

    const fullPath = path.join(DB_DIR, file);
    try {
      fs.unlinkSync(fullPath);
      console.log(`🗑️  삭제: ${file}`);
      deletedCount++;
    } catch (err) {
      console.error(`❌ 삭제 실패: ${file} -`, err.message);
    }
  }

  console.log(`\n✅ [DB 정리 완료] 삭제 ${deletedCount}건 / 보존 ${keptCount}건`);
}

main();