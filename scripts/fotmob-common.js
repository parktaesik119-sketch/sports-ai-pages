// scripts/fotmob-common.js
// fotmob.com(비공식 공개 API) 관련 공용 함수. fotmob-lineup-update.js와
// fetch-fotmob-context.js가 이 파일을 같이 써서, "팀 매칭"과 "경기 찾기" 로직이
// 두 곳에서 따로 존재하며 서서히 어긋나는 걸 막는다 (match-filter.js와 같은 이유).
//
// 프록시/쿠키가 전혀 필요 없다 — fotmob은 Cloudflare 챌린지가 없는 완전 공개 API라
// GitHub Actions IP에서 바로 직접 호출된다(실사용 테스트로 확인, 2026-07).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchTeam } from './espn-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────
// fotmob 전용 팀명 별칭 — matchTeam()으로도 못 잡는 표기 차이를 수동 등록.
// key는 team_name_map.js의 영문명, value는 fotmob이 실제로 쓰는 팀명.
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

export function matchTeamWithAlias(fotmobName, dbNameEn) {
  if (matchTeam(fotmobName, dbNameEn)) return true;
  const alias = FOTMOB_ALIASES[dbNameEn];
  if (alias && matchTeam(fotmobName, alias)) return true;
  return false;
}

// ─────────────────────────────────────────────
// 경기 목록 / 상세 조회
// ─────────────────────────────────────────────

// 날짜별 전체 경기 목록 (matchId, 팀명, 킥오프 시각 포함) — 검색 불필요, 목록 대조만 하면 됨
export async function fetchFotmobMatchesByDate(dateStr /* YYYY-MM-DD */) {
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

const matchesCache = {}; // KST 날짜문자열 -> 그날 경기 목록 (같은 프로세스 실행 안에서 재사용)
export async function getMatchesForDate(dateStr) {
  if (!(dateStr in matchesCache)) {
    matchesCache[dateStr] = await fetchFotmobMatchesByDate(dateStr);
  }
  return matchesCache[dateStr];
}

function toKstDateStr(dateLike) {
  const d = new Date(dateLike);
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 분석글의 실제 경기 일시(fmDateRaw, UTC)를 기준으로 fotmob 목록에서 같은 경기를 찾는다.
// 팀명 매칭 + 시간 근접(±6시간)을 같이 확인해서, 동명이인 팀(우루과이 Nacional vs
// 포르투갈 Nacional 같은 사례)이 엉뚱하게 매칭되는 사고를 방지한다.
export async function findFotmobMatch(fmDateRaw, homeTeamEn, awayTeamEn) {
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

export async function fetchMatchDetails(matchId) {
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
export const POS_LABEL = { 0: 'GK', 1: 'DF', 2: 'MF', 3: 'FW' };

export function formatFotmobLineup(teamLineup) {
  if (!teamLineup || !Array.isArray(teamLineup.starters)) return [];
  return teamLineup.starters.map(p => {
    const pos = POS_LABEL[p.usualPlayingPositionId] ?? '';
    const photo = `https://images.fotmob.com/image_resources/playerimages/${p.id}.png`;
    return `${p.name} (${pos})|${photo}`;
  });
}

export function toDisplayDateStr(utcTimeLike) {
  const d = new Date(utcTimeLike);
  if (Number.isNaN(d.getTime())) return '';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

export function toFotmobH2hDisplay(h2h, beforeDateStr) {
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
export function getFormOwnerId(formArray) {
  const first = formArray?.[0];
  if (!first) return null;
  if (first.home?.isOurTeam) return String(first.home.id);
  if (first.away?.isOurTeam) return String(first.away.id);
  return null;
}

const RESULT_EMOJI = { W: '🟢승', L: '🔴패', D: '🟡무' };

export function toFotmobRecentDisplay(formArr, beforeDateStr) {
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

// lineup.{home,away}Team.unavailable[] → espn-common.js의 extractInjuries()가 주는 것과
// 동일한 {name, status, detail} 형태로 변환한다. 이렇게 맞춰두면 analyze-router-one-git.js의
// formatInjuries()를 소스가 ESPN이든 fotmob이든 손 안 대고 그대로 재사용할 수 있다.
// (실제 unavailable[] 항목 구조를 실사용 데이터로 확인함: unavailability.type/expectedReturn, 2026-07)
export function extractFotmobInjuries(lineup) {
  const toItems = (list) => (list || []).map(p => ({
    name: p.name,
    status: p.unavailability?.type || 'injury',
    detail: p.unavailability?.expectedReturn || null,
  }));
  return {
    home: toItems(lineup?.homeTeam?.unavailable),
    away: toItems(lineup?.awayTeam?.unavailable),
  };
}
