// scripts/uefa-lineup-update.js
// UEFA 주관 대회(챔피언스리그 등)는 ESPN 커버리지가 예선전에서는 라인업을 안 주는 경우가 많아
// UEFA 공식 API(match.uefa.com)에서 직접 일정/매치ID를 확보해 라인업을 채워넣는 스크립트.
//
// ⚠️ 현재는 SUPPORTED_LEAGUES에 등록된 대회(챔피언스리그)만 지원한다.
//    컨퍼런스리그/유로파리그는 competitionId가 아직 확인 안 됐음 — 확인되는 대로
//    SUPPORTED_LEAGUES에 한 줄 추가하면 바로 지원된다.
// ⚠️ 확정 라인업(선발 11명) 조회 자체는 uefa-common.js의 fetchUefaLineup()이 아직
//    미구현 상태(엔드포인트 미확인)라, 이 스크립트는 지금은 "매치 매칭 + lineupStatus
//    확인"까지만 동작하고 실제 라인업 반영은 fetchUefaLineup()이 채워지는 대로 활성화된다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  UEFA_COMPETITION_ID,
  fetchUefaMatches,
  findUefaMatch,
  toKstDateStr,
  fetchUefaLineup,
} from './uefa-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');

// frontmatter의 한글 league 표기 → UEFA competitionId
// (유로파리그 competitionId 확인되면 여기에 한 줄 더 추가)
const SUPPORTED_LEAGUES = {
  'UEFA 챔피언스리그': UEFA_COMPETITION_ID.UCL,
  'UEFA 컨퍼런스리그': UEFA_COMPETITION_ID.UECL,
};

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
  return KO_TO_EN[koName] || koName; // 매핑 없으면 원문 그대로 (Zira처럼 매핑 안 된 팀명 대비)
}

// ─────────────────────────────────────────────
// md frontmatter 파싱/업데이트 — 다른 스크립트들과 동일
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

// ⚠️ 파일명 날짜는 "글 생성일"일 뿐이라 실제 경기일과 최대 ±2일 차이날 수 있다
// (espn-boxscore-update.js와 동일한 이유 — fetch-all.js가 D+2까지 미리 당겨온다).
function getKstDates() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const offsets = [-2, -1, 0, 1, 2];
  return offsets.map(n => new Date(now.getTime() + n * 86400000).toISOString().slice(0, 10));
}

function getTargetPostFiles() {
  const targetDates = getKstDates();
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && targetDates.some(d => f.startsWith(d)))
    .map(f => path.join(POSTS_DIR, f));
}

// espn-boxscore-update.js와 동일한 방식: 축구는 '번 '이 없으니 내용 존재 여부로 완료 판정
function isLineupComplete(rawLineup) {
  const unescaped = (rawLineup || '').replace(/\\"/g, '"').trim();
  return unescaped !== '' && unescaped !== '[]';
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  console.log('⚽ UEFA 대회 라인업 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  // 대상 필터링: category가 soccer이고, 지원 대회에 속하며, 라인업이 아직 미완료인 글만
  const targets = [];
  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);
    if ((fm.category || '') !== 'soccer') continue;

    const competitionId = SUPPORTED_LEAGUES[fm.league || ''];
    if (!competitionId) {
      // UEFA 대회인데 아직 미지원인 경우만 눈에 띄게 로그 (컨퍼런스/유로파 확장 시 참고용)
      if ((fm.league || '').startsWith('UEFA')) {
        console.log(`⏭️ [미지원 대회] ${path.basename(filePath)} — league: "${fm.league}" (competitionId 미확인, SUPPORTED_LEAGUES에 추가 필요)`);
      }
      continue;
    }

    if (isLineupComplete(fm.homeLineup) && isLineupComplete(fm.awayLineup)) {
      console.log(`⏩ [스킵] 라인업 완료: ${path.basename(filePath)}`);
      continue;
    }

    targets.push({ filePath, fm, competitionId });
  }

  if (targets.length === 0) {
    console.log('✅ 업데이트 대상 UEFA 글 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${targets.length}건`);

  // 날짜(UTC)+대회 단위로 일정을 캐싱해서 중복 호출 방지
  const scheduleCache = {}; // key: `${competitionId}:${kstDate}` -> fetchUefaMatches() 결과
  let updatedCount = 0;
  let skipCount    = 0;

  for (const { filePath, fm, competitionId } of targets) {
    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');
    const kstDate    = fm.date ? toKstDateStr(fm.date) : null;

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn} / 경기일(KST): ${kstDate}`);

    if (!kstDate) {
      console.log(`   ⚠️ date 필드 파싱 실패 — 스킵`);
      skipCount++;
      continue;
    }

    const cacheKey = `${competitionId}:${kstDate}`;
    if (!scheduleCache[cacheKey]) {
      console.log(`   📡 UEFA 일정 조회: ${kstDate} (competitionId=${competitionId})`);
      scheduleCache[cacheKey] = await fetchUefaMatches({
        competitionId,
        fromDate: kstDate,
        toDate: kstDate,
      }).catch(err => {
        console.error(`   ❌ UEFA 일정 조회 실패:`, err.message);
        return [];
      });
    }

    const matched = findUefaMatch(scheduleCache[cacheKey], homeTeamEn, awayTeamEn);
    if (!matched) {
      console.log(`   ⚠️ [매칭 실패] UEFA.com 일정에서 대응하는 경기를 못 찾음`);
      console.log(`      → 팀명 표기 차이이거나, api-sports 데이터가 실제 UEFA.com 정보와 다를 수 있음`);
      skipCount++;
      continue;
    }

    console.log(`   ✅ 매칭 성공 (matchId: ${matched.id}, lineupStatus: ${matched.lineupStatus})`);

    // 실측 확인됨: 라인업 준비되면 lineupStatus가 "TACTICAL_AVAILABLE"로 바뀐다
    // (matchId 2048621, Sabah vs The New Saints 경기로 확인, 2026-07-07)
    const AVAILABLE_LINEUP_STATUSES = ['TACTICAL_AVAILABLE', 'CONFIRMED', 'AVAILABLE'];
    if (!AVAILABLE_LINEUP_STATUSES.includes(matched.lineupStatus)) {
      console.log(`   ⏭️ 아직 라인업 미발표 (lineupStatus: ${matched.lineupStatus})`);
      skipCount++;
      continue;
    }

    let lineup;
    try {
      lineup = await fetchUefaLineup(matched.id);
    } catch (err) {
      console.log(`   ⚠️ 라인업 조회 미구현/실패: ${err.message}`);
      skipCount++;
      continue;
    }

    const updates = {
      homeLineup: JSON.stringify(lineup.home || []),
      awayLineup: JSON.stringify(lineup.away || []),
      homeFormation: lineup.homeFormation || '',
      awayFormation: lineup.awayFormation || '',
    };

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      console.log(`   🔄 업데이트 완료 | 홈 ${(lineup.home || []).length}건(${lineup.homeFormation}) / 원정 ${(lineup.away || []).length}건(${lineup.awayFormation})`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();