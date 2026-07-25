// scripts/fotmob-lineup-update.js
// footystats-lineup-update.js를 대체하는 스크립트. 이미 생성된 축구 분석글의
// homeTeam/awayTeam(한글)을 읽어서 fotmob.com(비공식 공개 API)에서 H2H·최근폼·
// 실제(또는 예상) 선발 라인업을 수집해온다.
//
// footystats와 달리 프록시/쿠키가 전혀 필요 없다 — fotmob은 Cloudflare 챌린지가
// 없는 완전 공개 API라 GitHub Actions IP에서 바로 직접 호출된다(실사용 테스트로
// 확인, 2026-07).
//
// 정책은 footystats-lineup-update.js와 동일하게 유지한다:
// - h2h/homeRecent/awayRecent: 기존에 이미 5개 이상 있으면 안 건드림. 부족한 만큼만
//   "날짜순 보충"(기존 항목 유지, 중복 추가 안 함).
// - homeLineup/awayLineup/homeFormation/awayFormation: 비어있을 때만 채움.
//
// fotmob 데이터 스키마 관련 특이사항(실사용 조사로 확인, 2026-07):
// - matches?date=... 엔드포인트로 그날 전체 리그의 경기목록(matchId 포함)을
//   한 번에 받아온다 — footystats처럼 팀명으로 검색(search.php)할 필요가 없다.
// - matchDetails?matchId=... 응답의 content.lineup.{home,away}Team.formation에
//   "4-3-3" 같은 포메이션 문자열이 이미 들어있어서, footystats/ESPN처럼
//   formation-common.js로 역산할 필요가 거의 없다(단, 라인업은 있는데 formation
//   문자열이 비어있는 극히 일부 경우를 대비해 폴백으로만 deriveFormationFromLineup 사용).
// - 선수 포지션은 문자열 코드(CB/CM/ST 등)가 아니라 숫자(usualPlayingPositionId:
//   0=GK, 1=DF, 2=MF, 3=FW)로 온다. 실제 4-4-2 라인업 데이터로 좌표(x)와 대조해서
//   검증 완료.
// - 선수 사진 URL은 응답에 없고 https://images.fotmob.com/image_resources/playerimages/{id}.png
//   패턴으로 직접 조립해야 한다(실제 접속으로 확인됨).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchTeam } from './espn-common.js';
import { deriveFormationFromLineup } from './formation-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');
const TARGET_COUNT = 5; // h2h/homeRecent/awayRecent를 이 개수까지 채운다

// ─────────────────────────────────────────────
// team_name_map.js(한글⇄영문) 로드
// ─────────────────────────────────────────────
function buildMaps(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const koToEn = {};
  const enToKo = {};
  for (const [, en, ko] of pairs) {
    if (!koToEn[ko]) koToEn[ko] = en;
    enToKo[en] = ko;
  }
  return { koToEn, enToKo };
}
const TEAM_MAP_PATH = path.resolve(__dirname, './team_name_map.js');
const { koToEn: KO_TO_EN } = buildMaps(TEAM_MAP_PATH);

function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

// ─────────────────────────────────────────────
// fotmob 전용 팀명 별칭 — matchTeam()으로도 못 잡는 표기 차이를 수동 등록.
// footystats-team-aliases.json과 달리 URL 경로가 아니라 "fotmob이 실제로 쓰는
// 팀명 문자열"을 등록한다(fotmob은 검색이 아니라 matches 목록에서 바로 이름
// 대조만 하면 되므로 URL이 필요 없음).
// ─────────────────────────────────────────────
const ALIAS_PATH = path.resolve(__dirname, 'fotmob-team-aliases.json');
function loadFotmobAliases() {
  try {
    const raw = JSON.parse(fs.readFileSync(ALIAS_PATH, 'utf-8'));
    delete raw._설명;
    return raw;
  } catch {
    return {};
  }
}
const FOTMOB_ALIASES = loadFotmobAliases();

function matchTeamWithAlias(fotmobName, dbNameEn) {
  if (matchTeam(fotmobName, dbNameEn)) return true;
  const alias = FOTMOB_ALIASES[dbNameEn];
  if (alias && matchTeam(fotmobName, alias)) return true;
  return false;
}

// ─────────────────────────────────────────────
// frontmatter 읽기/쓰기 (espn-boxscore-update.js / footystats-lineup-update.js와 동일)
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

// ⚠️ fetch-all.js가 축구를 D+3까지 미리 당겨와 분석글을 만들어두므로, 실제 경기는
// 파일명 날짜보다 최대 3일 뒤일 수 있다. espn-boxscore-update.js와 동일하게 ±2일
// 범위로 넉넉히 잡는다.
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

// ─────────────────────────────────────────────
// 기존 h2h/recent 배열 파싱 + 부족분 보충 (footystats-lineup-update.js와 동일 로직)
// ─────────────────────────────────────────────
function getExistingMatches(raw) {
  if (!raw) return { items: [] };
  const stripped = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!stripped || stripped === '[]') return { items: [] };
  if (!stripped.startsWith('[')) return { items: [] };
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return { items: parsed };
  } catch { /* fallthrough */ }
  return { items: null };
}

function parseDisplayDate(d) {
  const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return NaN;
  return new Date(`20${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
}

function isProbablySameMatch(a, b) {
  const aTime = parseDisplayDate(a.date);
  const bTime = parseDisplayDate(b.date);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return false;
  if (Math.abs(aTime - bTime) > 1 * 24 * 60 * 60 * 1000) return false;

  const scoreA = String(a.score || '').trim();
  const scoreB = String(b.score || '').trim();
  if (!scoreA || !scoreB) return false;
  const sameScoreDirect = scoreA === scoreB;
  const partsA = scoreA.split('-').map(s => s.trim());
  const partsB = scoreB.split('-').map(s => s.trim());
  const sameScoreSwapped = partsA.length === 2 && partsB.length === 2
    && partsA[0] === partsB[1] && partsA[1] === partsB[0];
  if (!sameScoreDirect && !sameScoreSwapped) return false;

  const homeMatches = matchTeam(a.home, b.home) || matchTeam(a.home, b.away);
  const awayMatches = matchTeam(a.away, b.home) || matchTeam(a.away, b.away);
  return homeMatches || awayMatches;
}

function supplementMatchList(existingItems, additionalItems, targetCount) {
  const need = targetCount - existingItems.length;
  if (need <= 0) return null;
  const candidates = additionalItems.filter(m =>
    !existingItems.some(e => isProbablySameMatch(e, m))
  );
  candidates.sort((a, b) => (a.date < b.date ? 1 : -1));
  const toAdd = candidates.slice(0, need);
  if (toAdd.length === 0) return null;
  const merged = [...existingItems, ...toAdd];
  merged.sort((a, b) => (a.date < b.date ? 1 : -1));
  return merged;
}

function isEmptyField(raw) {
  if (!raw) return true;
  return raw.trim().replace(/^['"]|['"]$/g, '').trim() === '';
}

// ─────────────────────────────────────────────
// fotmob API 호출
// ─────────────────────────────────────────────

// 날짜별 전체 경기 목록 (matchId, 팀명, 킥오프 시각 포함) — 검색 불필요, 목록 대조만 하면 됨
async function fetchFotmobMatchesByDate(dateStr /* YYYY-MM-DD */) {
  const d = dateStr.replace(/-/g, '');
  const url = `https://www.fotmob.com/api/data/matches?date=${d}&timezone=Asia%2FSeoul&ccode3=KOR&includeNextDayLateNight=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const flat = [];
    for (const lg of (data.leagues || [])) {
      for (const m of (lg.matches || [])) {
        flat.push({
          id: m.id,
          leagueId: lg.id,
          leagueName: lg.name,
          ccode: lg.ccode,
          utcTime: m.status?.utcTime || null,
          home: m.home?.name || '',
          away: m.away?.name || '',
          finished: !!m.status?.finished,
        });
      }
    }
    return flat;
  } catch (err) {
    console.error(`❌ fotmob matches 조회 실패 (${dateStr}):`, err.message);
    return [];
  }
}

const matchesCache = {}; // KST 날짜문자열 -> 그날 경기 목록 (같은 실행 안에서 재사용)
async function getMatchesForDate(dateStr) {
  if (!(dateStr in matchesCache)) {
    matchesCache[dateStr] = await fetchFotmobMatchesByDate(dateStr);
  }
  return matchesCache[dateStr];
}

function toKstDateStr(dateLike) {
  const d = new Date(dateLike);
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 분석글의 실제 경기 일시(fm.date, UTC)를 기준으로 fotmob 목록에서 같은 경기를 찾는다.
// 팀명 매칭 + 시간 근접(±6시간)을 같이 확인해서, 동명이인 팀(우루과이 Nacional vs
// 포르투갈 Nacional 같은 사례)이 엉뚱하게 매칭되는 사고를 방지한다.
async function findFotmobMatch(fmDateRaw, homeTeamEn, awayTeamEn) {
  const centerTs = new Date(fmDateRaw).getTime();
  if (Number.isNaN(centerTs)) return null;

  const centerDate = toKstDateStr(fmDateRaw);
  const datesToCheck = new Set([
    new Date(centerTs - 86400000).toISOString().slice(0, 10),
    centerDate,
    new Date(centerTs + 86400000).toISOString().slice(0, 10),
  ]);

  let candidates = [];
  for (const ds of datesToCheck) {
    candidates.push(...(await getMatchesForDate(ds)));
  }

  const matched = candidates.filter(c => {
    if (!c.utcTime) return false;
    const diffHours = Math.abs(new Date(c.utcTime).getTime() - centerTs) / 3600000;
    if (diffHours > 6) return false;
    return (matchTeamWithAlias(c.home, homeTeamEn) && matchTeamWithAlias(c.away, awayTeamEn))
        || (matchTeamWithAlias(c.home, awayTeamEn) && matchTeamWithAlias(c.away, homeTeamEn));
  });

  if (matched.length === 0) return null;
  matched.sort((a, b) =>
    Math.abs(new Date(a.utcTime).getTime() - centerTs) - Math.abs(new Date(b.utcTime).getTime() - centerTs)
  );
  return matched[0];
}

async function fetchMatchDetails(matchId) {
  const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`❌ matchDetails 조회 실패 (${matchId}):`, err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// fotmob 응답 → 우리 저장 포맷 변환
// ─────────────────────────────────────────────

// usualPlayingPositionId: 0=GK, 1=DF, 2=MF, 3=FW
// (4-4-2 실제 라인업 좌표 데이터로 검증 완료, 2026-07)
const POS_LABEL = { 0: 'GK', 1: 'DF', 2: 'MF', 3: 'FW' };

function formatFotmobLineup(teamLineup) {
  if (!teamLineup || !Array.isArray(teamLineup.starters)) return [];
  return teamLineup.starters.map(p => {
    const pos = POS_LABEL[p.usualPlayingPositionId] ?? '';
    const photo = `https://images.fotmob.com/image_resources/playerimages/${p.id}.png`;
    return `${p.name} (${pos})|${photo}`;
  });
}

function toDisplayDateStr(utcTimeLike) {
  const d = new Date(utcTimeLike);
  if (Number.isNaN(d.getTime())) return '';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

function toFotmobH2hDisplay(h2h, beforeDateStr) {
  if (!h2h || !Array.isArray(h2h.matches)) return [];
  const beforeTs = beforeDateStr ? new Date(beforeDateStr).getTime() : null;
  return h2h.matches
    .filter(m => m.status?.finished && m.status?.scoreStr)
    .filter(m => {
      if (!beforeTs) return true;
      const t = new Date(m.status?.utcTime || m.time?.utcTime).getTime();
      return !Number.isNaN(t) && t < beforeTs;
    })
    .map(m => ({
      date: toDisplayDateStr(m.status?.utcTime || m.time?.utcTime),
      home: m.home?.name || '',
      away: m.away?.name || '',
      score: (m.status?.scoreStr || '').replace(/\s+/g, ''),
    }))
    .filter(m => m.date);
}

// teamForm 배열 안의 각 항목이 "우리 쪽" 팀인지는 isOurTeam 플래그가 붙은 쪽의
// team id로 판별한다 — 배열 순서(0번=홈, 1번=원정)에 의존하지 않아 더 안전하다.
function getFormOwnerId(formArray) {
  const first = formArray?.[0];
  if (!first) return null;
  if (first.home?.isOurTeam) return String(first.home.id);
  if (first.away?.isOurTeam) return String(first.away.id);
  return null;
}

const RESULT_EMOJI = { W: '🟢승', L: '🔴패', D: '🟡무' };

function toFotmobRecentDisplay(formArr, beforeDateStr) {
  const beforeTs = beforeDateStr ? new Date(beforeDateStr).getTime() : null;
  return (formArr || [])
    .filter(item => {
      if (!beforeTs) return true;
      const t = new Date(item.date?.utcTime).getTime();
      return !Number.isNaN(t) && t < beforeTs;
    })
    .map(item => ({
      date: toDisplayDateStr(item.date?.utcTime),
      home: item.home?.name || '',
      away: item.away?.name || '',
      score: (item.score || '').replace(/\s+/g, ''),
      result: RESULT_EMOJI[item.resultString] || '🟡무',
    }))
    .filter(item => item.date);
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  console.log('🌍 fotmob 업데이트 시작\n');

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
  let skipCount = 0;
  const unmatchedLog = [];

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);
    const category = (fm.category || '').toLowerCase();
    if (category !== 'soccer') { skipCount++; continue; }

    const existingH2h        = getExistingMatches(fm.h2h);
    const existingHomeRecent = getExistingMatches(fm.homeRecent);
    const existingAwayRecent = getExistingMatches(fm.awayRecent);
    const homeLineupEmpty    = isEmptyField(fm.homeLineup);
    const awayLineupEmpty    = isEmptyField(fm.awayLineup);
    const homeFormationEmpty = isEmptyField(fm.homeFormation);
    const awayFormationEmpty = isEmptyField(fm.awayFormation);

    const needH2h        = existingH2h.items !== null && existingH2h.items.length < TARGET_COUNT;
    const needHomeRecent = existingHomeRecent.items !== null && existingHomeRecent.items.length < TARGET_COUNT;
    const needAwayRecent = existingAwayRecent.items !== null && existingAwayRecent.items.length < TARGET_COUNT;
    const needLineup = homeLineupEmpty || awayLineupEmpty || homeFormationEmpty || awayFormationEmpty;

    if (!needH2h && !needHomeRecent && !needAwayRecent && !needLineup) { skipCount++; continue; }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);
    console.log(`   필요: h2h(${existingH2h.items?.length ?? '파싱불가'}→${needH2h}) homeRecent(${existingHomeRecent.items?.length ?? '파싱불가'}→${needHomeRecent}) awayRecent(${existingAwayRecent.items?.length ?? '파싱불가'}→${needAwayRecent}) lineup(${needLineup})`);

    try {
      const candidate = await findFotmobMatch(fm.date, homeTeamEn, awayTeamEn);
      if (!candidate) {
        console.log(`   ⚠️ fotmob에서 경기 매칭 실패`);
        unmatchedLog.push({ file: path.basename(filePath), date: fm.date, home: homeTeamEn, away: awayTeamEn });
        skipCount++;
        continue;
      }
      console.log(`   ✅ 매칭: ${candidate.home} vs ${candidate.away} (matchId ${candidate.id}, ${candidate.leagueName})`);

      const details = await fetchMatchDetails(candidate.id);
      if (!details) { skipCount++; continue; }

      const updates = {};

      // fotmob의 general.homeTeam/awayTeam 순서가 우리 DB 기준 홈/원정과 같은지 확인
      // (반대로 올 수 있어서 반드시 한 번 더 대조 후 좌우를 맞춰야 함)
      const isHomeFirst = matchTeamWithAlias(details.general?.homeTeam?.name || '', homeTeamEn);

      const lineup = details.content?.lineup;
      const fotmobHomeLineup = isHomeFirst ? lineup?.homeTeam : lineup?.awayTeam;
      const fotmobAwayLineup = isHomeFirst ? lineup?.awayTeam : lineup?.homeTeam;

      if (needLineup && lineup) {
        if (homeLineupEmpty) {
          const items = formatFotmobLineup(fotmobHomeLineup);
          if (items.length > 0) updates.homeLineup = JSON.stringify(items);
        }
        if (awayLineupEmpty) {
          const items = formatFotmobLineup(fotmobAwayLineup);
          if (items.length > 0) updates.awayLineup = JSON.stringify(items);
        }

        // fotmob이 formation 문자열을 직접 주면 그대로 사용, 없으면(드문 경우)
        // 방금 만든 라인업의 GK/DF/MF/FW 라벨로부터 폴백 유추
        if (homeFormationEmpty) {
          if (fotmobHomeLineup?.formation) {
            updates.homeFormation = fotmobHomeLineup.formation;
          } else if (fotmobHomeLineup?.starters?.length) {
            const positions = fotmobHomeLineup.starters.map(p => ({ position: POS_LABEL[p.usualPlayingPositionId] || '' }));
            const derived = deriveFormationFromLineup(positions);
            if (derived) updates.homeFormation = derived;
          }
        }
        if (awayFormationEmpty) {
          if (fotmobAwayLineup?.formation) {
            updates.awayFormation = fotmobAwayLineup.formation;
          } else if (fotmobAwayLineup?.starters?.length) {
            const positions = fotmobAwayLineup.starters.map(p => ({ position: POS_LABEL[p.usualPlayingPositionId] || '' }));
            const derived = deriveFormationFromLineup(positions);
            if (derived) updates.awayFormation = derived;
          }
        }
      }

      if (needH2h) {
        const items = toFotmobH2hDisplay(details.content?.h2h, fm.date);
        const merged = supplementMatchList(existingH2h.items, items, TARGET_COUNT);
        if (merged) updates.h2h = JSON.stringify(merged);
      }

      if (needHomeRecent || needAwayRecent) {
        const teamForm = details.content?.matchFacts?.teamForm || [];
        const generalHomeId = String(details.general?.homeTeam?.id ?? '');
        const generalAwayId = String(details.general?.awayTeam?.id ?? '');
        const ourHomeId = isHomeFirst ? generalHomeId : generalAwayId;
        const ourAwayId = isHomeFirst ? generalAwayId : generalHomeId;

        let ourHomeFormArr = [];
        let ourAwayFormArr = [];
        for (const arr of teamForm) {
          const ownerId = getFormOwnerId(arr);
          if (ownerId === ourHomeId) ourHomeFormArr = arr;
          else if (ownerId === ourAwayId) ourAwayFormArr = arr;
        }

        if (needHomeRecent) {
          const items = toFotmobRecentDisplay(ourHomeFormArr, fm.date);
          const merged = supplementMatchList(existingHomeRecent.items, items, TARGET_COUNT);
          if (merged) updates.homeRecent = JSON.stringify(merged);
        }
        if (needAwayRecent) {
          const items = toFotmobRecentDisplay(ourAwayFormArr, fm.date);
          const merged = supplementMatchList(existingAwayRecent.items, items, TARGET_COUNT);
          if (merged) updates.awayRecent = JSON.stringify(merged);
        }
      }

      if (Object.keys(updates).length > 0) {
        const ok = updateMdFrontmatter(filePath, updates);
        if (ok) {
          console.log(`   🔄 업데이트 완료 | ${Object.keys(updates).join(', ')}`);
          updatedCount++;
        }
      } else {
        console.log(`   ℹ️ 채울 것 없음 (fotmob에도 보충할 데이터가 없었음)`);
        skipCount++;
      }
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  if (unmatchedLog.length > 0) {
    const logPath = path.resolve(__dirname, 'fotmob-unmatched-log.json');
    fs.writeFileSync(logPath, JSON.stringify(unmatchedLog, null, 2), 'utf-8');
    console.log(`\n📝 매칭 실패 ${unmatchedLog.length}건 → ${path.basename(logPath)} 에 기록 (별칭 등록 참고용)`);
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main().catch(err => {
  console.error('❌ [fotmob 업데이트] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});