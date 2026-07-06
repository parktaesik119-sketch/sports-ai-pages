// scripts/kbl-lineup-update.js
// KBL은 경기 전 라인업 사전공개가 없는 리그라, npb-lineup-update.js처럼
// "예고 발표를 미리 가져오는" 방식이 아니라 espn-boxscore-update.js처럼
// "경기가 시작/종료된 뒤 조회해서 실제 선발 명단을 채워넣는" 방식으로 동작한다.
//
// 실행: node kbl-lineup-update.js  (인자 없으면 오늘/어제/내일 날짜의 .md 파일 대상)
//       node kbl-lineup-update.js path/to/post1.md path/to/post2.md  (특정 파일 지정)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchKblGameList, fetchKblPlayerStat, findKblGame, toKstDateCode } from './kbl-common.js';

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
// md frontmatter 업데이트/파싱 (espn-boxscore-update.js / npb-lineup-update.js와 동일)
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
  console.log('🏀 KBL 라인업(선발출전) 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  // KBL 글만 필터링, 이미 5명 이상 채워져 있으면(선발 5인) 완료로 간주하고 스킵
  const targets = [];
  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);
    if ((fm.league || '') !== 'KBL') continue;

    const existingLineup = (fm.homeLineup || '').replace(/\\"/g, '"').trim();
    let existingCount = 0;
    try { existingCount = JSON.parse(existingLineup || '[]').length; } catch { /* noop */ }

    if (existingCount >= 5) {
      console.log(`⏩ [스킵] 선발 5인 이미 채워짐: ${path.basename(filePath)}`);
      continue;
    }
    targets.push({ filePath, fm });
  }

  if (targets.length === 0) {
    console.log('✅ 업데이트 대상 KBL 글 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${targets.length}건\n`);

  // 날짜별로 묶어서 일정 조회를 최소화 (같은 날짜면 fetchKblGameList 재사용)
  const gameListCache = {}; // key: 'YYYYMMDD' -> fetchKblGameList() 결과 배열

  let updatedCount = 0;
  let skipCount     = 0;

  for (const { filePath, fm } of targets) {
    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');
    const gameDate    = fm.date || '';
    const dateCode    = gameDate ? toKstDateCode(gameDate) : null;

    console.log(`🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);

    if (!dateCode) {
      console.log(`   ⚠️ 날짜 정보 없음 — 스킵\n`);
      skipCount++;
      continue;
    }

    if (!gameListCache[dateCode]) {
      console.log(`   📡 match/list 호출: ${dateCode}`);
      gameListCache[dateCode] = await fetchKblGameList(dateCode).catch(err => {
        console.error(`   ❌ match/list 호출 실패:`, err.message);
        return [];
      });
    }

    const matched = findKblGame(gameListCache[dateCode], homeTeamEn, awayTeamEn);
    if (!matched) {
      console.log(`   ⚠️ 매칭 실패 (팀명 매핑 문제이거나 해당 날짜에 경기 없음)\n`);
      skipCount++;
      continue;
    }

    if (!matched.isStarted) {
      console.log(`   ⏭️ 아직 경기 시작 전 — 선발 명단 없음, 스킵\n`);
      skipCount++;
      continue;
    }

    const stat = await fetchKblPlayerStat(matched.gmkey).catch(err => {
      console.error(`   ❌ player-stat 호출 실패:`, err.message);
      return null;
    });

    if (!stat) {
      console.log(`   ⚠️ 선수기록 조회 실패\n`);
      skipCount++;
      continue;
    }

    // 선발 라인업 포맷: "포지션 이름(등번호)|사진URL" — KBO/NPB 스크립트와 톤 맞춤
    function buildLines(teamBlock) {
      return teamBlock.starters.map(p => {
        let line = `${p.pos} ${p.name}(${p.backNum})`;
        if (p.photoUrl) line += `|${p.photoUrl}`;
        return line;
      });
    }

    const homeLines = buildLines(stat.home);
    const awayLines = buildLines(stat.away);

    if (homeLines.length === 0 && awayLines.length === 0) {
      console.log(`   ⚠️ 선발 명단 비어있음 (아직 라인업 데이터 미반영일 수 있음)\n`);
      skipCount++;
      continue;
    }

    const updates = {
      homeLineup: JSON.stringify(homeLines),
      awayLineup: JSON.stringify(awayLines),
    };

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      console.log(`   ✅ 업데이트 완료 | 홈 선발 ${homeLines.length}명 / 원정 선발 ${awayLines.length}명\n`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();