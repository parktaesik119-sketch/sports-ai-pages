// scripts/archive-old-posts.js
// src/content/posts/ 안의 파일 중, 파일명 앞 날짜(YYYY-MM-DD)가 기준일보다 오래된
// 것들을 src/content/archive/ 로 옮긴다. 두 컬렉션은 config.ts에서 완전히 같은
// 스키마를 쓰므로 내용은 손대지 않고 파일 위치만 이동한다.
//
// 이 스크립트는 archive-build.yml에서만 실행한다 — lineup-update.yml(평소 30분
// 주기 빠른 빌드)에서는 절대 실행하면 안 된다. 평소 빌드가 posts 컬렉션 크기를
// 계속 작게 유지해야 빌드 시간이 안 늘어나는 게 이 구조의 핵심이기 때문.
//
// 기준: 경기 종료 후 며칠 지나면 recent/h2h/lineup 갱신 스크립트들이 더 이상
// 이 글을 건드리지 않는다(±2일 범위 밖). 그래서 기본값을 7일로 잡아서, "더 이상
// 아무 것도 안 바뀌는" 시점부터는 archive로 넘긴다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const POSTS_DIR   = path.resolve(__dirname, '../src/content/posts');
const ARCHIVE_DIR = path.resolve(__dirname, '../src/content/archive');
const THRESHOLD_DAYS = Number(process.env.ARCHIVE_THRESHOLD_DAYS || 7);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function extractFileDate(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}T00:00:00+09:00`); // 파일명 날짜는 KST 기준으로 해석
}

function main() {
  console.log(`🗄️  [아카이브 이동] 시작 — 기준: ${THRESHOLD_DAYS}일 지난 글\n`);

  if (!fs.existsSync(POSTS_DIR)) {
    console.log('⚠️ src/content/posts 없음 — 종료');
    return;
  }
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const today = getKstToday();
  const cutoff = new Date(today.getTime() - THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  let movedCount = 0, skippedNoDate = 0, keptCount = 0;

  for (const file of files) {
    const fileDate = extractFileDate(file);
    if (!fileDate) {
      skippedNoDate++;
      continue;
    }

    if (fileDate.getTime() < cutoff.getTime()) {
      const from = path.join(POSTS_DIR, file);
      const to   = path.join(ARCHIVE_DIR, file);
      fs.renameSync(from, to);
      movedCount++;
    } else {
      keptCount++;
    }
  }

  console.log(`✅ 이동: ${movedCount}건 / 유지: ${keptCount}건 / 날짜 인식 실패(건드리지 않음): ${skippedNoDate}건`);
}

main();
