// scripts/kbo-lineup-update.js
// espn-boxscore-update.js와 같은 시간대(매시 정각)에 함께 실행되는 KBO 전용 경량 라인업 갱신 스크립트.
// fetch-kbo-context.js(선발투수분석+구종분석+라인업 전부 수집)와 달리
// 이 스크립트는 "라인업만" 다시 불러서 GetKboGameList + GetLineUpAnalysis 2개 호출로 끝낸다.
// (선발투수 ERA/WAR나 구종 데이터는 경기 당일 크게 안 바뀌므로 매시간 다시 부를 필요 없음)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchKboGameList, findKboGame, fetchLineupAnalysis, KBO_TEAM_CODE_MAP } from './kbo-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성 — espn-boxscore-update.js와 동일 로직
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
// md frontmatter 파싱/업데이트 — espn-boxscore-update.js와 동일
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
// KBO 라인업 → espn-boxscore-update.js와 동일한 "N번 이름 (포지션)" 표기로 통일
// (프론트엔드가 이 형식을 파싱하므로 그대로 맞춘다. WAR 등 부가 수치는 넣지 않음)
// ─────────────────────────────────────────────
function formatKboLineupLines(team) {
  if (!team?.lineup?.length) return [];
  return team.lineup.map(b => `${b.order}번 ${b.name} (${b.position})`);
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  console.log('⚾ KBO 라인업 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  const gameListCache = {}; // key: 'YYYYMMDD' -> fetchKboGameList() 결과
  let updatedCount = 0;
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    // 타자 라인업(번 N)이 이미 채워져 있으면 스킵 — espn-boxscore-update.js와 동일 기준
    const existingLineup = fm.homeLineup || '';
    if (existingLineup.includes('번 ')) {
      console.log(`⏩ [스킵] 타자 라인업 완료: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    // KBO 리그 게시글만 처리 (다른 리그는 espn-boxscore-update.js가 담당)
    const league = (fm.league || '').toUpperCase();
    if (league !== 'KBO') {
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    if (!KBO_TEAM_CODE_MAP[homeTeamEn] || !KBO_TEAM_CODE_MAP[awayTeamEn]) {
      console.log(`⚠️ [팀코드 매핑 없음] ${fm.homeTeam} vs ${fm.awayTeam} — KBO_TEAM_CODE_MAP 확인 필요`);
      skipCount++;
      continue;
    }

    const dateStr = getDateFromFilename(filePath);
    if (!dateStr) {
      console.log(`⚠️ [스킵] 날짜 추출 실패: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }
    const dateCode = dateStr.replace(/-/g, '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn} / 날짜: ${dateCode}`);

    if (!gameListCache[dateCode]) {
      console.log(`   📡 GetKboGameList 호출: ${dateCode}`);
      gameListCache[dateCode] = await fetchKboGameList(dateCode).catch(err => {
        console.error(`   ❌ GetKboGameList 실패:`, err.message);
        return [];
      });
    }

    const matched = findKboGame(gameListCache[dateCode], homeTeamEn, awayTeamEn);
    if (!matched) {
      console.log(`   ⚠️ 경기 매칭 실패`);
      skipCount++;
      continue;
    }

    const lineup = await fetchLineupAnalysis({
      leId: matched.leId, srId: matched.srId, seasonId: matched.seasonId, gameId: matched.gameId,
    }).catch(err => {
      console.error(`   ❌ GetLineUpAnalysis 실패:`, err.message);
      return null;
    });

    const homeLineupLines = formatKboLineupLines(lineup?.home);
    const awayLineupLines = formatKboLineupLines(lineup?.away);

    // 선발투수 이름을 맨 앞에 추가 (GetKboGameList에 이미 포함된 데이터라 API 호출 추가 없음)
    // ⚠️ ERA/WAR 등 상세 기록은 안 붙임 - 이 스크립트는 "가벼운" 매시간 재조회 목적이라
    //    (파일 상단 주석 참고) 상세 기록까지 넣으려면 GetPitcherRecordAnalysis를 추가로
    //    불러야 해서 별도 논의 필요
    if (matched.home?.starterName) {
      homeLineupLines.unshift(`선발투수 ${matched.home.starterName}`);
    }
    if (matched.away?.starterName) {
      awayLineupLines.unshift(`선발투수 ${matched.away.starterName}`);
    }

    if (homeLineupLines.length === 0 && awayLineupLines.length === 0) {
      console.log(`   ⚠️ 라인업 데이터 없음 (아직 미발표일 수 있음)`);
      skipCount++;
      continue;
    }

    const updates = {
      homeLineup: JSON.stringify(homeLineupLines),
      awayLineup: JSON.stringify(awayLineupLines),
    };

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      console.log(`   🔄 업데이트 완료 | ${lineup.lineupConfirmed ? '확정' : '예상'} 라인업 | 홈 ${homeLineupLines.length}건 / 원정 ${awayLineupLines.length}건`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();