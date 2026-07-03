// scripts/npb-lineup-update.js
// NPB(일본프로야구)는 ESPN이 커버하지 않아서 espn-boxscore-update.js 대상에서 빠진다.
// npb.jp의 予告先発投手(예고선발) 페이지에서 선발투수만 가져와 기존 글의
// homeLineup/awayLineup 필드에 채워넣는다 (형식은 espn-boxscore-update.js와 완전히 동일:
// "선발투수 {이름}" 또는 "선발투수 {이름}|{사진URL}").
//
// ⚠️ NPB는 타순 라인업 사전공개 자체가 없는 리그라, 이 스크립트는 선발투수 한 줄만 채운다.
//    (KBO처럼 나중에 타자 라인업이 추가로 채워지는 2단계 업데이트가 없음 — 애초에 그런 데이터가 없음)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchStarterAnnouncements, findNpbGame, parseAnnouncedDate, toKstDateStr } from './npb-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const POSTS_DIR = path.resolve(__dirname, '../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성 (espn-boxscore-update.js와 동일 로직)
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
// md frontmatter 업데이트 (espn-boxscore-update.js와 동일)
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
  console.log('⚾ NPB 라인업(선발투수) 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  // NPB 글만 필터링 (league === 'NPB'), 이미 선발투수가 채워져 있으면 스킵
  const targets = [];
  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);
    if ((fm.league || '') !== 'NPB') continue;

    const existingLineup = (fm.homeLineup || '').replace(/\\"/g, '"').trim();
    if (existingLineup && existingLineup !== '[]' && existingLineup.includes('선발투수')) {
      console.log(`⏩ [스킵] 이미 선발투수 채워짐: ${path.basename(filePath)}`);
      continue;
    }
    targets.push({ filePath, fm });
  }

  if (targets.length === 0) {
    console.log('✅ 업데이트 대상 NPB 글 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${targets.length}건`);

  // 예고선발 페이지는 한 번만 호출 (게임마다 다시 호출할 필요 없음)
  console.log(`📡 予告先発投手 페이지 호출...`);
  const { announcedForText, games } = await fetchStarterAnnouncements().catch(err => {
    console.error(`❌ 예고선발 페이지 호출 실패:`, err.message);
    return { announcedForText: null, games: [] };
  });
  const announcedDate = parseAnnouncedDate(announcedForText);
  console.log(`   발표 기준: ${announcedForText || '(파싱 실패)'} (${announcedDate || '날짜 파싱 실패'}) | 총 ${games.length}경기 수집됨\n`);

  let updatedCount = 0;
  let skipCount     = 0;

  for (const { filePath, fm } of targets) {
    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');
    const gameDate    = fm.date || '';
    const gameDateKst = gameDate ? toKstDateStr(gameDate) : null;

    console.log(`🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);

    if (announcedDate && gameDateKst && gameDateKst !== announcedDate) {
      console.log(`   ⏭️ 날짜 불일치 (경기일 ${gameDateKst} / 예고선발 페이지는 ${announcedDate}분만 제공) — 스킵\n`);
      skipCount++;
      continue;
    }

    const matched = findNpbGame(games, homeTeamEn, awayTeamEn);
    if (!matched) {
      console.log(`   ⚠️ 매칭 실패 (아직 발표 전이거나 팀명 매핑 문제)\n`);
      skipCount++;
      continue;
    }

    // espn-boxscore-update.js와 동일 포맷: "선발투수 {이름}" + 사진 있으면 "|{URL}"
    function buildLine(side) {
      const name  = matched[side]?.pitcherNameEn || matched[side]?.pitcherName;
      const photo = matched[side]?.photoUrl;
      if (!name) return null;
      let line = `선발투수 ${name}`;
      if (photo) line += `|${photo}`;
      return line;
    }

    const homeLine = buildLine('home');
    const awayLine = buildLine('away');

    if (!homeLine && !awayLine) {
      console.log(`   ⚠️ 선발투수 이름 없음\n`);
      skipCount++;
      continue;
    }

    const updates = {
      homeLineup: JSON.stringify(homeLine ? [homeLine] : []),
      awayLineup: JSON.stringify(awayLine ? [awayLine] : []),
    };

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      console.log(`   ✅ 업데이트 완료 | 선발: ${matched.away?.pitcherNameEn || matched.away?.pitcherName} vs ${matched.home?.pitcherNameEn || matched.home?.pitcherName}\n`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();