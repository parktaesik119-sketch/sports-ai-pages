// scripts/npb-photo-update.js
// espn-boxscore-update.js / npb-lineup-update.js와 같은 시간대에 함께 실행되는
// NPB 타자 라인업 + 사진 보강 스크립트.
//
// 배경: npb-lineup-update.js는 npb.jp의 予告先発投手(예고선발) 페이지만 스크래핑해서
// homeLineup/awayLineup에 "선발투수 {이름}" 한 줄만 채운다(NPB는 KBO처럼 타순을
// 사전에 공식 발표하는 리그가 아니라서). 이 스크립트는 그 뒤에 실제 타순이 잡히면
// (경기 시작 전후, 네이버가 라인업을 확보하는 시점) 네이버 스포츠의 비공식 게이트웨이에서
// 타자 명단(이름+포지션+pCode)을 가져와 기존 선발투수 줄 뒤에 "N번 이름 (포지션)|사진"
// 형식으로 이어붙인다 (KBO의 homeLineup/awayLineup과 동일한 표기 형식).
//
// ⚠️ 이미 있는 선발투수 줄은 절대 건드리지 않는다. 타자 줄이 하나도 없을 때만 통째로
//    추가하고, 이미 타자 줄이 있으면(한 번 채워진 뒤에는) 스킵한다 — KBO의 "1단계
//    투수만 → 2단계 타자 추가" 병합 로직과 달리, NPB는 라인업이 한 번에 통째로
//    확정 발표되는 방식이라 부분 병합할 필요가 없음(실사용 데이터 구조 확인, 2026-08).
//
// 사진 URL 형식(실사용 확인, 2026-08): 물음표 쿼리 없음(KBO와 다름)
//   https://sports-phinf.pstatic.net/player/npb/default/{pCode}.png
//   ⚠️ NPB는 대부분 선수 사진을 지원하지 않는다. pCode가 있어도 실제 이미지가
//      기본 실루콘 이미지로 나올 수 있음 — 이건 네이버 쪽 데이터 한계이고 이
//      스크립트가 이미지 존재 여부까지 검증하지는 않는다(요청마다 이미지를 직접
//      받아봐야 해서 비용이 큼).
//
// 게임 ID 포맷(실사용 확인, 2026-08): 날짜8 + 원정팀코드2 + 홈팀코드2 + 더블헤더1
//   예: "20260802HSYA0" (한신@야쿠르트), "20260802SFRT0" (소프트뱅크@라쿠텐)
//   ⚠️ npb.jp 쪽에는 이 gameId가 없어서(KBO의 matched.gameId 같은 게 없음) 팀코드로
//      직접 조립한다. 더블헤더 두 번째 경기는 마지막 숫자가 "1"이 되는데, 그 경우까지는
//      대응하지 않음(더블헤더 자체가 드물고, 실패해도 스킵되고 다음 실행에서 재시도됨).
//
// 네이버 팀코드(실사용 캡처로 12팀 전체 확인, 2026-08):
//   오릭스=OX, 세이부=SE, 닛폰햄=NH, 지바롯데=JL, 요미우리=YO, 요코하마(DeNA)=YK,
//   야쿠르트=YA, 한신=HS, 라쿠텐=RT, 소프트뱅크=SF, 히로시마=HI, 주니치=JN
//
// [선발투수 이름 교체] 기존 선발투수 줄의 이름은 npb.jp 예고선발 페이지에서 온 것인데,
// 타자 이름(네이버, 한글)과 표기가 안 맞을 수 있어서(로마자/한자 등) 같은 game-polling
// 응답의 result.game.homeStarterName/awayStarterName(한글)로 이름만 바꿔치기한다.
// ERA/승패 괄호와 사진 URL은 그대로 유지 — 이름 텍스트만 교체.
// ⚠️ 이거 때문에 "타자 줄이 이미 다 있는 경기"도 더 이상 완전히 스킵하지 않고,
//    매번 이름이 최신인지 확인한다(달라진 게 없으면 그냥 스킵 로그만 찍고 파일은 안 건드림).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toKstDateStr } from './npb-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');

// team_name_map.js의 영문 키 → 네이버 2글자 팀코드 (실사용 네트워크 캡처로 12팀 전체 확인)
const NPB_NAVER_TEAM_CODE_MAP = {
  'Chiba Lotte Marines': 'JL',
  'Chunichi Dragons': 'JN',
  'Fukuoka S. Hawks': 'SF',
  'Hanshin Tigers': 'HS',
  'Hiroshima Carp': 'HI',
  'Nippon Ham Fighters': 'NH',
  'Orix Buffaloes': 'OX',
  'Rakuten Gold. Eagles': 'RT',
  'Seibu Lions': 'SE',
  'Yakult Swallows': 'YA',
  'Yokohama BayStars': 'YK',
  'Yomiuri Giants': 'YO',
};

// 네이버가 영어 포지션 약어로 주는 값 → 기존 KBO 표기와 통일된 한글 포지션명
const POSITION_KO_MAP = {
  P: '투수', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수',
  SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자',
};

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

function buildNaverPhotoUrl(playerId) {
  return `https://sports-phinf.pstatic.net/player/npb/default/${playerId}.png`;
}

// "선발투수 다케우치 (10-5, 3.20)|https://..." 같은 줄에서 이름 부분만 newName으로 교체.
// ERA/승패 괄호, 사진 URL은 그대로 유지. newName이 없거나 줄 형식이 안 맞으면 원본 그대로 반환.
function replacePitcherName(line, newName) {
  const str = String(line);
  const m = str.match(/^선발투수\s+(.+)$/);
  if (!m || !newName) return str;

  const rest = m[1]; // 예: "다케우치 (10-5, 3.20)|https://..." 또는 "다케우치"
  const barIdx = rest.indexOf('|');
  const withoutPhoto = barIdx === -1 ? rest : rest.slice(0, barIdx);
  const photoSuffix = barIdx === -1 ? '' : rest.slice(barIdx); // "|https://..." 또는 ""

  const statsMatch = withoutPhoto.match(/^(.+?)\s(\([^)]*\))\s*$/);
  const statsSuffix = statsMatch ? ` ${statsMatch[2]}` : ''; // " (10-5, 3.20)" 또는 ""

  return `선발투수 ${newName}${statsSuffix}${photoSuffix}`;
}

// /record 엔드포인트의 homeBatter/awayBatter 배열(각 항목: name, posName(이미 한글),
// playerId, batOrder) → "N번 이름 (포지션)|사진" 배열.
// ⚠️ 2026-08 실사용 캡처로 구조 확정: 예전에 가정했던 game-polling의
// textRelayData.baseInfo.batterLineup 경로는 존재하지 않는 필드였음(버그 원인).
// posName은 네이버가 이미 한글로 내려주므로 POSITION_KO_MAP 변환이 필요 없음.
// 배열 순서를 신뢰하지 않고 batOrder 필드로 명시적으로 정렬한다.
function buildBatterLines(batterArr) {
  if (!Array.isArray(batterArr) || batterArr.length === 0) return [];
  return [...batterArr]
    .sort((a, b) => (a.batOrder ?? 0) - (b.batOrder ?? 0))
    .map((p) => {
      const posKo = p.posName || POSITION_KO_MAP[p.pos] || '';
      let line = `${p.batOrder}번 ${p.name} (${posKo})`;
      if (p.playerId) line += `|${buildNaverPhotoUrl(p.playerId)}`;
      return line;
    });
}

async function fetchNaverGamePolling(gameId) {
  const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling`;
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'origin': 'https://m.sports.naver.com',
      'referer': 'https://m.sports.naver.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.success || !data?.result) throw new Error('응답 구조 이상');
  return data.result;
}

// ⚠️ 타자 라인업(batOrder/posName/playerId)은 game-polling이 아니라 이 /record
// 엔드포인트에만 존재한다(2026-08 실사용 캡처로 확인, 이전엔 game-polling 응답 안에
// 있다고 잘못 가정해서 항상 빈 배열만 나오던 버그였음). 선발투수 이름은 기존대로
// game-polling 쪽(result.game.homeStarterName)이 이미 정상 동작하므로 그대로 둔다.
async function fetchNaverRecord(gameId) {
  const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/record`;
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'origin': 'https://m.sports.naver.com',
      'referer': 'https://m.sports.naver.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.success || !data?.result) throw new Error('응답 구조 이상');
  return data.result;
}

async function main() {
  console.log('📸 NPB 타자 라인업+사진 / 선발투수 이름 보강 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 대상 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  let updatedCount = 0;
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    if ((fm.league || '') !== 'NPB') {
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');
    const homeCode = NPB_NAVER_TEAM_CODE_MAP[homeTeamEn];
    const awayCode = NPB_NAVER_TEAM_CODE_MAP[awayTeamEn];

    if (!homeCode || !awayCode) {
      console.log(`⚠️ [팀코드 매핑 없음] ${fm.homeTeam} vs ${fm.awayTeam} — NPB_NAVER_TEAM_CODE_MAP 확인 필요`);
      skipCount++;
      continue;
    }

    const homeStored = parseStoredLineupArray(fm.homeLineup);
    const awayStored = parseStoredLineupArray(fm.awayLineup);

    // 선발투수 줄 자체가 없으면(npb-lineup-update.js가 아직 못 채움) 이 경기는 대상 아님
    const homeHasPitcher = homeStored.some(l => String(l).startsWith('선발투수'));
    const awayHasPitcher = awayStored.some(l => String(l).startsWith('선발투수'));
    if (!homeHasPitcher && !awayHasPitcher) {
      skipCount++;
      continue;
    }

    // 타자 줄("N번 ")이 이미 있으면 타자 쪽은 완료 — NPB는 한 번에 통째로 확정되므로 부분 병합 불필요.
    // (단, 투수 이름 교체는 타자 완료 여부와 무관하게 매번 확인해야 하므로 여기서 스킵하지 않음)
    const homeHasBatters = homeStored.some(l => /^\d+번\s/.test(String(l)));
    const awayHasBatters = awayStored.some(l => /^\d+번\s/.test(String(l)));

    if (!fm.date) {
      skipCount++;
      continue;
    }
    const dateCode = toKstDateStr(fm.date).replace(/-/g, '');
    const gameId = `${dateCode}${awayCode}${homeCode}0`;

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn}(${homeCode}) / 원정: ${fm.awayTeam} → ${awayTeamEn}(${awayCode}) / gameId: ${gameId}`);

    let result;
    try {
      result = await fetchNaverGamePolling(gameId);
    } catch (err) {
      console.error(`   ❌ 네이버 game-polling 조회 실패 (${gameId}):`, err.message, '(아직 라인업 미확정일 수 있음 — 다음 실행에서 재시도)');
      skipCount++;
      continue;
    }

    // 타자 라인업은 game-polling이 아니라 별도의 /record 엔드포인트에서 온다.
    // 이 호출이 실패해도(예: 아직 타순 미확정) 투수명 교체는 계속 진행할 수 있어야
    // 하므로, 여기서는 continue하지 않고 homeBatters/awayBatters를 빈 배열로 둔다.
    let recordResult = null;
    try {
      recordResult = await fetchNaverRecord(gameId);
    } catch (err) {
      console.error(`   ⚠️ 네이버 record 조회 실패 (${gameId}):`, err.message, '(아직 타순 미확정일 수 있음 — 다음 실행에서 재시도)');
    }

    const homeBatters = recordResult?.recordData?.homeBatter || [];
    const awayBatters = recordResult?.recordData?.awayBatter || [];
    const homeStarterName = result?.game?.homeStarterName || null;
    const awayStarterName = result?.game?.awayStarterName || null;

    // 각 사이드: 선발투수 이름 교체(있으면) + 타자 줄 추가(아직 없으면)를 함께 계산
    function rebuildSide(storedLines, hasBatters, batters, starterName) {
      let changed = false;
      let lines = storedLines.map(l => {
        if (!String(l).startsWith('선발투수')) return l;
        const replaced = replacePitcherName(l, starterName);
        if (replaced !== l) changed = true;
        return replaced;
      });
      let addedBatters = 0;
      if (!hasBatters && batters?.length > 0) {
        lines = [...lines, ...buildBatterLines(batters)];
        addedBatters = batters.length;
        changed = true;
      }
      return { lines, changed, addedBatters };
    }

    const homeResult = rebuildSide(homeStored, homeHasBatters, homeBatters, homeStarterName);
    const awayResult = rebuildSide(awayStored, awayHasBatters, awayBatters, awayStarterName);

    const updates = {};
    if (homeResult.changed) updates.homeLineup = JSON.stringify(homeResult.lines);
    if (awayResult.changed) updates.awayLineup = JSON.stringify(awayResult.lines);

    if (Object.keys(updates).length === 0) {
      console.log(`   ℹ️ 변경 없음 (타자 라인업 미발표 또는 이미 최신 상태 — 다음 실행에서 재시도)`);
      skipCount++;
      continue;
    }

    const ok = updateMdFrontmatter(filePath, updates);
    if (ok) {
      const homeNote = homeResult.addedBatters > 0 ? `타자 ${homeResult.addedBatters}명 추가` : (updates.homeLineup ? '투수명 교체' : '변경없음');
      const awayNote = awayResult.addedBatters > 0 ? `타자 ${awayResult.addedBatters}명 추가` : (updates.awayLineup ? '투수명 교체' : '변경없음');
      console.log(`   🔄 업데이트 완료 | 홈: ${homeNote} / 원정: ${awayNote}`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();