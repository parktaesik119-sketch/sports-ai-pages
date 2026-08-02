// scripts/kbo-photo-update.js
// espn-boxscore-update.js / kbo-lineup-update.js와 같은 시간대에 함께 실행되는
// KBO 타자 "사진"만 보강하는 스크립트.
//
// 배경: kbo-lineup-update.js가 쓰는 KBO 공식 API(GetLineUpAnalysis)는 타자 사진을
// 제공하지 않는다(선발투수는 getKboPlayerPhotoUrl로 이미 사진이 붙음). 그래서
// 네이버 스포츠 프리뷰 API(비공식, api-gw.sports.naver.com)에서 같은 경기의
// 타자 명단(playerName + playerCode)을 가져와 이름이 일치하면 그 playerCode로
// 사진 URL을 만들어 기존 라인업 줄 끝에 "|사진주소"만 이어붙인다.
//
// ⚠️ 라인업의 이름/포지션/타순 텍스트 자체는 전혀 건드리지 않는다. 오직 사진이
// 없는 타자 줄에 사진만 "추가"한다 — 기존 정보를 지우거나 형식을 바꾸지 않음.
//
// 사진 URL 형식(실사용 확인, 2026-08):
//   https://sports-phinf.pstatic.net/player/kbo/default/{playerCode}.png?type=w150
//
// 네이버 프리뷰 API:
//   GET https://api-gw.sports.naver.com/schedule/games/{gameId}/preview
//   응답 → result.previewData.homeTeamLineUp.fullLineUp / awayTeamLineUp.fullLineUp
//   fullLineUp의 각 항목: { playerName, playerCode, batorder, positionName, ... }
//   (선발투수 항목은 batorder가 없음 — 타자만 batorder 있는 항목으로 구분)
//
// gameId는 kbo-lineup-update.js와 동일하게 findKboGame()이 반환하는 matched.gameId를
// 그대로 재사용한다(KBO 공식 stats gameId와 네이버 gameId 포맷이 동일함, 실사용 확인).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchKboGameList, findKboGame, KBO_TEAM_CODE_MAP } from './kbo-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성 — 다른 스크립트들과 동일 로직
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
// md frontmatter 파싱/업데이트 — 다른 스크립트들과 동일 로직
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
// 저장된 라인업(frontmatter 문자열) ↔ 배열 변환
// ─────────────────────────────────────────────
function parseStoredLineupArray(raw) {
  const unescaped = (raw || '').replace(/\\"/g, '"').trim();
  if (!unescaped || unescaped === '[]') return [];
  try {
    const arr = JSON.parse(unescaped);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// "3번 오스틴 (1루수)" → { order: 3, name: '오스틴', position: '1루수' }
// 이미 사진이 붙어 있는 줄("...|photo")은 파싱은 하되 hasPhoto로 구분해서 건드리지 않는다.
function parseBatterLine(line) {
  const str = String(line);
  const hasPhoto = str.includes('|');
  const withoutPhoto = hasPhoto ? str.slice(0, str.indexOf('|')) : str;
  const m = withoutPhoto.match(/^(\d+)번\s+(.+?)\s+\(([^)]*)\)\s*$/);
  if (!m) return null; // 선발투수 줄 등 타순 표기가 없는 줄은 대상 아님
  return { order: Number(m[1]), name: m[2].trim(), position: m[3].trim(), hasPhoto, raw: str };
}

// 네이버 프리뷰 API의 fullLineUp에서 "타순이 있는(=타자)" 선수만 이름→playerCode 맵으로 변환
// (선발투수 항목은 batorder가 없어서 자동으로 제외됨)
function buildNaverBatterCodeMap(fullLineUp) {
  const map = {};
  for (const p of (fullLineUp || [])) {
    if (typeof p.batorder !== 'number') continue;
    const name = (p.playerName || '').trim();
    if (name && p.playerCode) map[name] = String(p.playerCode);
  }
  return map;
}

function buildNaverPhotoUrl(playerCode) {
  return `https://sports-phinf.pstatic.net/player/kbo/default/${playerCode}.png?type=w150`;
}

// 기존 라인업 배열(문자열들)에 사진이 없는 타자 줄만 골라 네이버 코드맵으로 사진을 이어붙인다.
// 반환: { lines: 갱신된 배열, addedCount: 새로 붙인 사진 수 }
function applyPhotosToLineup(storedLines, naverCodeMap) {
  let addedCount = 0;
  const newLines = storedLines.map(line => {
    const parsed = parseBatterLine(line);
    if (!parsed || parsed.hasPhoto) return line; // 선발투수 줄이거나 이미 사진 있음 → 그대로 둠

    const code = naverCodeMap[parsed.name];
    if (!code) return line; // 네이버 쪽에서 이름 매칭 실패 → 다음 실행에서 재시도

    addedCount++;
    return `${parsed.raw}|${buildNaverPhotoUrl(code)}`;
  });
  return { lines: newLines, addedCount };
}

async function fetchNaverPreview(gameId) {
  const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/preview`;
  const res  = await fetch(url, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'origin': 'https://m.sports.naver.com',
      'referer': 'https://m.sports.naver.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.success || !data?.result?.previewData) throw new Error('응답 구조 이상');
  return data.result.previewData;
}

async function main() {
  console.log('📸 KBO 타자 사진 보강 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 대상 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  const gameListCache = {}; // key: 'YYYYMMDD' -> fetchKboGameList() 결과
  let updatedCount = 0;
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    // KBO 리그 게시글만 처리
    const league = (fm.league || '').toUpperCase();
    if (league !== 'KBO') {
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    if (!KBO_TEAM_CODE_MAP[homeTeamEn] || !KBO_TEAM_CODE_MAP[awayTeamEn]) {
      skipCount++;
      continue;
    }

    // 타자 라인업(번 N) 자체가 아직 없으면 사진 붙일 대상이 없음 → 스킵
    // (kbo-lineup-update.js가 먼저/나중에 실행되든 상관없이, 그때그때 frontmatter 상태만 본다)
    const homeStored = parseStoredLineupArray(fm.homeLineup);
    const awayStored = parseStoredLineupArray(fm.awayLineup);
    const homeHasBatters = homeStored.some(l => /\d+번\s/.test(String(l)));
    const awayHasBatters = awayStored.some(l => /\d+번\s/.test(String(l)));

    if (!homeHasBatters && !awayHasBatters) {
      skipCount++;
      continue;
    }

    // 이미 모든 타자 줄에 사진이 붙어 있으면 할 일 없음 → 스킵
    const homeNeedsPhoto = homeStored.some(l => { const p = parseBatterLine(l); return p && !p.hasPhoto; });
    const awayNeedsPhoto = awayStored.some(l => { const p = parseBatterLine(l); return p && !p.hasPhoto; });

    if (!homeNeedsPhoto && !awayNeedsPhoto) {
      skipCount++;
      continue;
    }

    const dateStr = getDateFromFilename(filePath);
    if (!dateStr) {
      skipCount++;
      continue;
    }
    const dateCode = dateStr.replace(/-/g, '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn} / 날짜: ${dateCode}`);

    if (!gameListCache[dateCode]) {
      gameListCache[dateCode] = await fetchKboGameList(dateCode).catch(err => {
        console.error(`   ❌ GetKboGameList 실패:`, err.message);
        return [];
      });
    }

    const matched = findKboGame(gameListCache[dateCode], homeTeamEn, awayTeamEn);
    if (!matched || !matched.gameId) {
      console.log(`   ⚠️ 경기 매칭 실패`);
      skipCount++;
      continue;
    }

    let previewData;
    try {
      previewData = await fetchNaverPreview(matched.gameId);
    } catch (err) {
      console.error(`   ❌ 네이버 프리뷰 조회 실패 (${matched.gameId}):`, err.message);
      skipCount++;
      continue;
    }

    const homeCodeMap = buildNaverBatterCodeMap(previewData?.homeTeamLineUp?.fullLineUp);
    const awayCodeMap = buildNaverBatterCodeMap(previewData?.awayTeamLineUp?.fullLineUp);

    const updates = {};
    let totalAdded = 0;

    if (homeNeedsPhoto) {
      const { lines, addedCount } = applyPhotosToLineup(homeStored, homeCodeMap);
      if (addedCount > 0) {
        updates.homeLineup = JSON.stringify(lines);
        totalAdded += addedCount;
      }
    }
    if (awayNeedsPhoto) {
      const { lines, addedCount } = applyPhotosToLineup(awayStored, awayCodeMap);
      if (addedCount > 0) {
        updates.awayLineup = JSON.stringify(lines);
        totalAdded += addedCount;
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log(`   ℹ️ 이름 매칭된 사진 없음 (아직 네이버에 라인업 미발표일 수 있음 — 다음 실행에서 재시도)`);
      skipCount++;
      continue;
    }

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      console.log(`   🔄 사진 추가 완료 | 총 ${totalAdded}명`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();