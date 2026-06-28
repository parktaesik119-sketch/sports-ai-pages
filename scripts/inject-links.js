// inject-links.js
// 실행: node inject-links.js
// 역할: 신형 MD 파일의 homeRecent/awayRecent/h2h 텍스트에 분석글 링크 삽입
// 대상: 파일명 날짜 기준 -5일 ~ +2일, homeRecent 또는 awayRecent 또는 h2h 필드 있는 파일만

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import TEAM_NAME_MAP from './team_name_map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POSTS_DIR = path.resolve(__dirname, '../src/content/posts');
const DB_PATH   = path.resolve(__dirname, '../database/all-fixtures.json');
const BASE_URL  = 'https://pick79.com/posts/detail';

// =====================
// 역방향 팀명 맵 생성 (한글 → 영문 배열, 동일 한글명 여러 영문키 모두 보존)
// =====================
const REVERSE_MAP = {};
for (const [eng, kor] of Object.entries(TEAM_NAME_MAP)) {
  if (!REVERSE_MAP[kor]) REVERSE_MAP[kor] = [];
  REVERSE_MAP[kor].push(eng);
}

// =====================
// 유틸
// =====================
function getSafeLogoName(name) {
  if (!name) return '';
  return String(name)
    .trim().toLowerCase()
    .replace(/[\/\\]/g, '-').replace(/\./g, '-')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/fc|cf|afc|sc|club/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// "26/06/24" → "2026-06-24"
function parseRecentDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [yy, mm, dd] = parts;
  return `20${yy}-${mm}-${dd}`;
}

// "2026.06.24" → "2026-06-24"
function parseH2hDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// =====================
// DB 로드 및 slug 인덱스 빌드
// =====================
console.log('📂 DB 로드 중...');
const allFixtures = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

const slugIndex = new Map();
for (const m of allFixtures) {
  if (!m.date || !m.home || !m.away || !m.id) continue;
  const dateKey = m.date.slice(0, 10);
  const key = `${dateKey}_${normalizeName(m.home)}_${normalizeName(m.away)}`;
  const slug = `analyze-${m.id}-${dateKey}-${getSafeLogoName(m.home)}`;
  slugIndex.set(key, slug);
}
console.log(`✅ DB 인덱스 ${slugIndex.size}건 구축 완료`);


// =====================
// slug 탐색 (KST→UTC 1일 차이 보정 + 동일 한글명 여러 영문키 전체 시도)
// =====================
function findSlug(dateStr, homeName, awayName) {
  const engHomes = REVERSE_MAP[homeName] || [homeName];
  const engAways = REVERSE_MAP[awayName] || [awayName];

  // KST 날짜가 UTC보다 하루 앞설 수 있으므로 -1일도 시도
  const dates = [dateStr];
  const prev = new Date(dateStr);
  prev.setDate(prev.getDate() - 1);
  dates.push(prev.toISOString().slice(0, 10));

  for (const date of dates) {
    for (const engHome of engHomes) {
      for (const engAway of engAways) {
        const key = `${date}_${normalizeName(engHome)}_${normalizeName(engAway)}`;
        if (slugIndex.has(key)) return slugIndex.get(key);
      }
    }
  }
  return null;
}

// =====================
// frontmatter 파싱
// =====================
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return match[1];
}

// =====================
// homeRecent/awayRecent 처리 (JSON 배열에 link 필드 추가)
// =====================
function processRecentJson(jsonStr) {
  let items;
  try {
    items = JSON.parse(jsonStr);
  } catch (e) {
    return { changed: false, result: jsonStr };
  }

  let changed = false;
  const processed = items.map(item => {
    // text 필드 제거 (h2h 구버전 잔재)
    const { text, ...rest } = item;
    if (text) changed = true;

    if (rest.link) return rest; // 이미 링크 있으면 스킵

    const dateStr = parseRecentDate(rest.date) || parseH2hDate(rest.date);
    if (!dateStr) return rest;

    const slug = findSlug(dateStr, rest.home, rest.away);
    if (!slug) return rest;

    changed = true;
    return { ...rest, link: `${BASE_URL}/${slug}/` };
  });

  return { changed, result: JSON.stringify(processed) };
}

// =====================
// h2h 처리 (JSON 배열 방식 - homeRecent와 동일한 방식)
// "2026.06.24 - 홈팀 (스코어) 원정팀" 형식을 파싱해서 JSON 배열로 변환
// =====================
function processH2h(h2hStr) {
  if (!h2hStr || h2hStr === '없음' || h2hStr.includes('업데이트 예정')) {
    return { changed: false, result: h2hStr };
  }

  // 이미 JSON 배열이면 link 필드 추가 방식으로 처리
  if (h2hStr.trim().startsWith('[')) {
    return processRecentJson(h2hStr);
  }

  // 파이프 구분 텍스트 형식 처리
  const items = h2hStr.split('|');
  let changed = false;

  const processed = items.map(item => {
    const trimmed = item.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) return JSON.parse(trimmed); // 이미 JSON

    // "2026.06.24 - 홈팀 (스코어) 원정팀" 파싱
    const m = trimmed.match(/^(\d{4}\.\d{2}\.\d{2})\s*-\s*(.+?)\s*\(([^)]+)\)\s*(.+)$/);
    if (!m) return { text: trimmed };

    const [, dateRaw, homeName, score, awayName] = m;
    const dateStr = parseH2hDate(dateRaw);
    if (!dateStr) return { text: trimmed };

    const slug = findSlug(dateStr, homeName.trim(), awayName.trim());
    const obj = {
      date: dateRaw,
      home: homeName.trim(),
      score,
      away: awayName.trim(),
      text: trimmed
    };
    if (slug) {
      obj.link = `${BASE_URL}/${slug}/`;
      changed = true;
    }
    return obj;
  }).filter(Boolean);

  return { changed, result: JSON.stringify(processed) };
}

// =====================
// 메인 처리
// =====================
function main() {
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));

  // KST 기준 오늘 날짜
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr).getTime();

  let totalProcessed = 0;
  let totalChanged = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);

    // 파일명에서 날짜 추출 (예: 2026-06-28-1489420-croatia.md)
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) { totalSkipped++; continue; }

    const fileDate = new Date(dateMatch[1]).getTime();
    const diffDays = (todayMs - fileDate) / (24 * 60 * 60 * 1000);

    // -5일 ~ +2일 범위 (과거 5일 ~ 미래 2일)
    if (diffDays > 5 || diffDays < -2) {
      totalSkipped++;
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(content);
    if (!fm) { totalSkipped++; continue; }

    const hasHomeRecent = fm.includes('homeRecent:');
    const hasAwayRecent = fm.includes('awayRecent:');
    const hasH2h = fm.includes('h2h:');

    if (!hasHomeRecent && !hasAwayRecent && !hasH2h) {
      totalSkipped++;
      continue;
    }

    totalProcessed++;
    let newContent = content;
    let fileChanged = false;

    // homeRecent 처리
    if (hasHomeRecent) {
      const m = newContent.match(/homeRecent:\s*'([\s\S]*?)'\r?(?=\n[a-zA-Z]|\n---)/m);
      if (m) {
        const { changed, result } = processRecentJson(m[1]);
        if (changed) {
          newContent = newContent.replace(m[0], `homeRecent: '${result}'`);
          fileChanged = true;
        }
      }
    }

    // awayRecent 처리
    if (hasAwayRecent) {
      const m = newContent.match(/awayRecent:\s*'([\s\S]*?)'(?=\n[a-zA-Z]|\n---)/m);
      if (m) {
        const { changed, result } = processRecentJson(m[1]);
        if (changed) {
          newContent = newContent.replace(m[0], `awayRecent: '${result}'`);
          fileChanged = true;
        }
      }
    }

    // h2h 처리 - 싱글쿼트 또는 더블쿼트 모두 처리, 결과는 싱글쿼트로 저장
    if (hasH2h) {
      // 싱글쿼트 먼저 시도
      let hm = newContent.match(/h2h:\s*'([\s\S]*?)'(?=\n[a-zA-Z]|\n---)/m);
      let quoteType = 'single';
      if (!hm) {
        hm = newContent.match(/h2h:\s*"([\s\S]*?)"(?=\n[a-zA-Z]|\n---)/m);
        quoteType = 'double';
      }
      if (hm) {
        const { changed, result } = processH2h(hm[1]);
        if (changed) {
          // 항상 싱글쿼트로 저장 (더블쿼트 충돌 방지)
          newContent = newContent.replace(hm[0], `h2h: '${result}'`);
          fileChanged = true;
        }
      }
    }

    if (fileChanged) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
      console.log(`🔗 링크 삽입: ${file}`);
      totalChanged++;
    }
  }

  console.log('\n====================================');
  console.log(`📋 처리 대상: ${totalProcessed}건`);
  console.log(`✅ 링크 삽입: ${totalChanged}건`);
  console.log(`⏩ 스킵: ${totalSkipped}건`);
  console.log('====================================');
}

main();