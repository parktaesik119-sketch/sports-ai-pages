// scripts/cleanup-database.js
// database/ 폴더에 매일 쌓이는 날짜별 파일(api-sports 일일 경기일정, espn-context)을
// 당일 것만 남기고 정리합니다. all-fixtures.json 같은 누적 마스터 DB는 건드리지 않습니다.
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

// 정리 대상 파일명 패턴: YYYY-MM-DD.json, espn-context-YYYY-MM-DD.json
// (날짜가 안 박혀있는 all-fixtures.json, team_name_map.js 등은 매칭 안 되므로 자동 보존됨)
const DATED_FILE_PATTERNS = [
  /^(\d{4}-\d{2}-\d{2})\.json$/,
  /^espn-context-(\d{4}-\d{2}-\d{2})\.json$/,
];

function extractDate(filename) {
  for (const pattern of DATED_FILE_PATTERNS) {
    const m = filename.match(pattern);
    if (m) return m[1];
  }
  return null;
}

function main() {
  console.log('🧹 [DB 정리] 시작\n');

  const today = getKstToday();

  if (!fs.existsSync(DB_DIR)) {
    console.log(`⚠️ database 폴더 없음: ${DB_DIR}`);
    return;
  }

  const files = fs.readdirSync(DB_DIR);
  let deletedCount = 0;
  let keptCount = 0;

  for (const file of files) {
    const fileDate = extractDate(file);
    if (!fileDate) continue; // 날짜 패턴이 아닌 파일(all-fixtures.json 등)은 건드리지 않음

    if (fileDate === today) {
      keptCount++;
      continue; // 당일 파일은 보존
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

  console.log(`\n✅ [DB 정리 완료] 삭제 ${deletedCount}건 / 당일 보존 ${keptCount}건`);
}

main();