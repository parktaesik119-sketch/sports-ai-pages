// scripts/sofascore-lineup-update.js
// kbo-lineup-update.js / espn-boxscore-update.js와 같은 시간대에 함께 실행되는
// SofaScore 전용 라인업·포메이션·선수사진 갱신 스크립트 (축구/농구/배구/하키 대상).
//
// 라인업은 경기 임박 전에는 미확정이거나 아예 안 나오는 경우가 많아서, 파이프라인
// 초반에 실행되는 fetch-sofascore-context.js의 캐시 파일을 읽지 않고 실행 시점에
// SofaScore를 직접 재조회한다(KBO의 kbo-lineup-update.js와 동일한 이유).
//
// ⚠️ main-auto.js에는 포함하지 않는다 — kbo-lineup-update.js/espn-boxscore-update.js와
// 마찬가지로 별도 스케줄(경기 임박 시간대)에 반복 실행되어야 한다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CAT_TO_SOFASCORE_SPORT,
  searchTeamId,
  findEventId,
  fetchLineups,
} from './sofascore-common.js';
import { closeSofascoreBrowser } from './sofascore-browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성 — kbo-lineup-update.js와 동일 로직.
// frontmatter의 homeTeam/awayTeam은 한글로 저장돼 있어서, SofaScore 검색에 쓰려면
// 다시 영문으로 되돌려야 한다.
// ─────────────────────────────────────────────
function buildReverseMap(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const reverse = {};
  for (const [, en, ko] of pairs) {
    if (!reverse[ko]) reverse[ko] = en;
  }
  return reverse;
}
const TEAM_MAP_PATH = path.resolve(__dirname, './team_name_map.js');
const KO_TO_EN = buildReverseMap(TEAM_MAP_PATH);
function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

// ─────────────────────────────────────────────
// md frontmatter 파싱/업데이트 — kbo-lineup-update.js와 동일
// ─────────────────────────────────────────────
function updateMdFrontmatter(filePath, updates) {
  let content  = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) { console.warn(`⚠️ frontmatter 없음: ${filePath}`); return false; }

  let fm = fmMatch[1];
  for (const [key, value] of Object.entries(updates)) {
    const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const regex   = new RegExp(`^${key}:.*$`, 'm');
    if (regex.test(fm)) {
      fm = fm.replace(regex, `${key}: "${escaped}"`);
    } else {
      fm = fm.trimEnd() + `\n${key}: "${escaped}"`;
    }
  }

  const newContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${fm}\n---`);
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

function parseFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match   = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
}

function getDateFromFilename(filePath) {
  const m = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function getKstDates() {
  const now       = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today     = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow  = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  return [today, yesterday, tomorrow];
}

function getTargetPostFiles() {
  const targetDates = getKstDates();
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && targetDates.some(d => f.startsWith(d)))
    .map(f => path.join(POSTS_DIR, f));
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  console.log('⚽ SofaScore 라인업/포메이션 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  let updatedCount = 0;
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    const cat = (fm.category || '').toLowerCase();
    const sportName = CAT_TO_SOFASCORE_SPORT[cat];
    if (!sportName) {
      // 축구/농구/배구/하키가 아니면 이 스크립트 대상이 아님 (야구는 kbo-lineup-update.js,
      // ESPN 커버 리그는 espn-boxscore-update.js가 담당)
      skipCount++;
      continue;
    }

    // lineupConfirmed 필드로 명시적으로 완료 여부를 추적한다(KBO처럼 텍스트 내용을
    // 휴리스틱으로 스니핑하지 않고, 이 스크립트가 직접 남긴 플래그를 신뢰).
    if (fm.lineupConfirmed === 'true') {
      console.log(`⏩ [스킵] 확정 라인업 이미 반영됨: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    const dateStr = getDateFromFilename(filePath);
    if (!dateStr) {
      console.log(`⚠️ [스킵] 날짜 추출 실패: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    console.log(`\n🔍 [${cat}] ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);

    try {
      const homeTeam = await searchTeamId(homeTeamEn, sportName);
      if (!homeTeam) {
        console.log(`   ⚠️ SofaScore 팀 검색 실패(홈): ${homeTeamEn}`);
        skipCount++;
        continue;
      }

      const eventId = await findEventId(homeTeam.id, awayTeamEn, dateStr);
      if (!eventId) {
        console.log(`   ⚠️ 이벤트 매칭 실패 — 팀명 매칭 또는 일정 확인 필요`);
        skipCount++;
        continue;
      }

      const lineups = await fetchLineups(eventId, sportName);
      if (!lineups || (!lineups.home?.formattedLines?.length && !lineups.away?.formattedLines?.length)) {
        console.log(`   ℹ️ 라인업 데이터 없음 (아직 미발표일 수 있음)`);
        skipCount++;
        continue;
      }

      const updates = {
        homeLineup: JSON.stringify(lineups.home?.formattedLines || []),
        awayLineup: JSON.stringify(lineups.away?.formattedLines || []),
        homeFormation: lineups.home?.formation || '',
        awayFormation: lineups.away?.formation || '',
        lineupConfirmed: lineups.confirmed ? 'true' : 'false',
      };

      const ok = updateMdFrontmatter(filePath, updates);
      if (ok) {
        console.log(`   🔄 업데이트 완료 | ${lineups.confirmed ? '확정' : '예상'} 라인업 | 홈 ${lineups.home?.formattedLines?.length || 0}명(${lineups.home?.formation || '포메이션 없음'}) / 원정 ${lineups.away?.formattedLines?.length || 0}명(${lineups.away?.formation || '포메이션 없음'})`);
        updatedCount++;
      }
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main().finally(() => closeSofascoreBrowser());