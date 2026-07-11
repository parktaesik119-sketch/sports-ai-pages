// scripts/sofascore-common.js
// SofaScore 비공식 공개 REST API(www.sofascore.com/api/v1/*) 호출 공통 로직.
//
// KBO(/ws/*.asmx)와 달리 인증/쿠키 없이 그대로 호출되는 것을 실사용 브라우저 네트워크
// 캡처로 확인함(2026-07-11 기준). 다만 비공식 엔드포인트이므로 SofaScore 쪽에서
// 응답 구조를 예고 없이 바꿀 수 있음 — 호출 실패/구조 변경 시 이 파일의 파서만 손보면 되도록
// fetch-sofascore-context.js와 분리해둔다.
//
// fetch-sofascore-context.js가 이 파일의 함수들을 사용해 축구/농구/배구/하키의
// H2H·최근폼·라인업(포메이션 포함)·선수사진을 수집한다.
// (배당(odds)은 최근폼/H2H 평균 기반 자체 예상스코어 시스템이 이미 있어 수집하지 않는다)
// ⚠️ SofaScore는 결장자/부상자 정보를 제공하지 않는다(실사용 테스트로 확인, K리그 기준
//    "Missing players" 류의 위젯 자체가 없음) — 그 부분은 계속 ESPN/KBO 등이 담당한다.

import { matchTeam } from './espn-common.js';

const BASE = 'https://www.sofascore.com/api/v1';
const IMG_BASE = 'https://img.sofascore.com/api/v1';

const COMMON_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

async function getJson(url) {
  const res = await fetch(url, { headers: COMMON_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} 실패: HTTP ${res.status}`);
  return res.json();
}

// analyze-router-one-git.js의 cat('soccer'|'basketball'|'volleyball'|'hockey') →
// SofaScore search 응답의 entity.sport.name 표기. (야구/LOL은 기존 KBO/NPB/자체 DB로
// 충분해서 대상에서 제외 — 필요해지면 여기에 추가하면 됨)
export const CAT_TO_SOFASCORE_SPORT = {
  soccer: 'Football',
  basketball: 'Basketball',
  volleyball: 'Volleyball',
  hockey: 'Ice hockey',
};

// ─────────────────────────────────────────────
// 1. 팀 검색: api-sports 영문 팀명 → SofaScore 팀 ID
// ─────────────────────────────────────────────
export async function searchTeamId(teamNameEn, sportName) {
  const data = await getJson(`${BASE}/search/all?q=${encodeURIComponent(teamNameEn)}`);
  const candidates = (data.results || [])
    .filter(r => r.type === 'team' && r.entity?.sport?.name === sportName);

  for (const c of candidates) {
    if (matchTeam(c.entity.name, teamNameEn)) {
      return { id: c.entity.id, name: c.entity.name };
    }
  }
  // 퍼지 매칭 완전 실패 시, 종목이 맞는 최상위 검색결과로 폴백(SofaScore 검색 자체가
  // 이미 유사도순 정렬). 틀린 팀이 잡혀도 findEventId()에서 상대팀+날짜로 한 번 더
  // 검증하므로 최종적으로는 걸러진다.
  return candidates[0] ? { id: candidates[0].entity.id, name: candidates[0].entity.name } : null;
}

// ─────────────────────────────────────────────
// 2. 팀의 예정/최근 경기 목록에서 상대팀+날짜로 이번 경기의 eventId를 찾는다.
// ─────────────────────────────────────────────
export async function findEventId(teamId, opponentNameEn, matchDateStr) {
  const target = new Date(matchDateStr);
  if (Number.isNaN(target.getTime())) return null;

  const validDates = new Set([
    new Date(target.getTime() - 86400000).toISOString().slice(0, 10),
    matchDateStr.slice(0, 10),
    new Date(target.getTime() + 86400000).toISOString().slice(0, 10),
  ]);

  // 예정 경기 목록에서 우선 찾고, 없으면(이미 지난 경기 등) 최근 경기 목록도 확인한다.
  for (const endpoint of ['events/next/0', 'events/last/0']) {
    const data = await getJson(`${BASE}/team/${teamId}/${endpoint}`).catch(() => null);
    const events = data?.events || [];
    for (const e of events) {
      const dateStr = new Date(e.startTimestamp * 1000).toISOString().slice(0, 10);
      if (!validDates.has(dateStr)) continue;
      const homeName = e.homeTeam?.name || '';
      const awayName = e.awayTeam?.name || '';
      if (matchTeam(homeName, opponentNameEn) || matchTeam(awayName, opponentNameEn)) {
        return e.id;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// 3. eventId(숫자) → customId(문자 slug). h2h/events 엔드포인트는 숫자 id가 아니라
//    이 customId를 요구한다(실사용 테스트로 확인 — 숫자 id로 호출하면 error 응답이 옴).
// ─────────────────────────────────────────────
export async function fetchCustomId(eventId) {
  const data = await getJson(`${BASE}/event/${eventId}`);
  return data.event?.customId || null;
}

// ─────────────────────────────────────────────
// 4. H2H(맞대결 이력) — customId 기준. 종목 무관 공통 포맷.
// ─────────────────────────────────────────────
export async function fetchH2hEvents(customId, limit = 10) {
  const data = await getJson(`${BASE}/event/${customId}/h2h/events`);
  const events = data.events || [];
  return events
    .filter(e => e.status?.type === 'finished')
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, limit)
    .map(e => ({
      date: new Date(e.startTimestamp * 1000).toISOString().slice(0, 10),
      home: e.homeTeam?.name || '',
      away: e.awayTeam?.name || '',
      homeScore: e.homeScore?.current ?? null,
      awayScore: e.awayScore?.current ?? null,
      tournament: e.tournament?.name || '',
    }));
}

// ─────────────────────────────────────────────
// 5. 팀 단독 최근 폼(H2H와 달리 상대 무관, 그 팀의 최근 경기 결과)
// ─────────────────────────────────────────────
export async function fetchTeamRecent(teamId, limit = 10) {
  const data = await getJson(`${BASE}/team/${teamId}/events/last/0`);
  const events = data.events || [];
  return events
    .filter(e => e.status?.type === 'finished')
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, limit)
    .map(e => ({
      date: new Date(e.startTimestamp * 1000).toISOString().slice(0, 10),
      home: e.homeTeam?.name || '',
      away: e.awayTeam?.name || '',
      homeScore: e.homeScore?.current ?? null,
      awayScore: e.awayScore?.current ?? null,
      tournament: e.tournament?.name || '',
    }));
}

// ─────────────────────────────────────────────
// 6. 라인업 + 포메이션(축구) + 선수 정보. 경기 임박 전에는 confirmed:false로
//    "예상 라인업"이 오거나 아예 404가 날 수 있다(KBO의 예상/확정 라인업과 같은 개념).
// ─────────────────────────────────────────────
export async function fetchLineups(eventId, sportName = 'Football') {
  const data = await getJson(`${BASE}/event/${eventId}/lineups`).catch(() => null);
  if (!data) return null;

  function side(team) {
    if (!team) return null;
    const parsed = {
      formation: team.formation || null,
      players: (team.players || []).map(p => ({
        id: p.player?.id ?? null,
        name: p.player?.name || '',
        position: p.position || p.player?.position || '',
        jerseyNumber: p.jerseyNumber || p.player?.jerseyNumber || '',
        substitute: !!p.substitute,
        photoUrl: p.player?.id ? getPlayerPhotoUrl(p.player.id) : null,
      })),
    };
    // _slug_.astro가 그대로 JSON.stringify해서 homeLineup/awayLineup frontmatter에 넣을 수 있는
    // "{이름} ({포지션})|{사진URL}" 문자열 배열도 미리 만들어서 같이 내려준다.
    parsed.formattedLines = formatSofascoreLineupLines(parsed, { sportName });
    return parsed;
  }

  return {
    confirmed: !!data.confirmed,
    home: side(data.home),
    away: side(data.away),
  };
}

export function getPlayerPhotoUrl(playerId) {
  if (!playerId) return null;
  return `${IMG_BASE}/player/${playerId}/image`;
}

export function getTeamLogoUrl(teamId) {
  if (!teamId) return null;
  return `${IMG_BASE}/team/${teamId}/image`;
}

// ─────────────────────────────────────────────
// _slug_.astro 프론트엔드가 기대하는 정확한 문자열 포맷으로 변환.
// 형식: "{선수명} ({포지션코드})|{사진URL}"
// (_slug_.astro의 getPosBadge/stripPos/getPhoto가 이 포맷을 파싱함 — 2026-07-11 확인)
//
// ⚠️ 포메이션 피치뷰(_slug_.astro 342~371행)는 이 배열의 "순서(인덱스)"를 formation
// 문자열의 줄 수(예: "4-2-3-1" → GK,DF4,MF2,MF3,FW1)에 맞춰 그대로 좌표에 꽂는다.
// SofaScore의 position 필드는 G/D/M/F로만 뭉뚱그려 오고 세부 라인(수비형/공격형 미드필더)
// 구분이 없어서, 같은 M 그룹 내에서 어느 선수가 앞줄/뒷줄인지는 API만으로는 확정할 수 없다.
// → G/D/M/F 버킷 순서(원본 배열 순서 그대로 유지)로만 정렬해서 최선의 근사치를 만든다.
//
// ⚠️ 포지션 코드 체계는 종목마다 다르다(실사용 테스트로 확인):
// - 축구: G/D/M/F (골키퍼/수비/미드필더/공격수) → _slug_.astro가 인식하는 GK/DF/MF/FW로 변환
// - 농구: G/F/C/FG/CF 등 (가드/포워드/센터, 혼합 포지션도 있음) → 축구식으로 바꾸면 완전히
//   틀린 라벨이 된다(농구 가드 "G"가 "GK(골키퍼)"로 잘못 표시됨). _slug_.astro의 getPosBadge()가
//   category==='basketball'일 때 "G"를 따로 처리하도록 이미 되어 있으므로, 축구가 아니면
//   원본 코드를 그대로 넘겨서 프론트엔드 쪽 판단에 맡긴다.
// - 배구/하키는 아직 실사용 테스트 전 — 마찬가지로 원본 코드를 그대로 넘긴다.
// ─────────────────────────────────────────────
const SOCCER_POS_TO_BADGE = { G: 'GK', D: 'DF', M: 'MF', F: 'FW' };
const POS_BUCKET_ORDER = { G: 0, D: 1, M: 2, F: 3, C: 2, FG: 0.5, CF: 2.5 };

export function formatSofascoreLineupLines(side, { includeSubstitutes = false, sportName = 'Football' } = {}) {
  if (!side?.players?.length) return [];

  const isSoccer = sportName === 'Football';
  const players = side.players.filter(p => includeSubstitutes || !p.substitute);

  // 버킷 순서로 정렬하되, 같은 버킷 안에서는 원본 배열 순서를 그대로 보존
  // (Array.prototype.sort는 안정 정렬이므로 원본 순서가 tie-break로 유지됨)
  const sorted = [...players].sort((a, b) => {
    const ba = POS_BUCKET_ORDER[a.position] ?? 9;
    const bb = POS_BUCKET_ORDER[b.position] ?? 9;
    return ba - bb;
  });

  return sorted.map(p => {
    const badge = isSoccer ? (SOCCER_POS_TO_BADGE[p.position] || p.position || '') : (p.position || '');
    const photo = p.photoUrl || '';
    const base = `${p.name} (${badge})`;
    return photo ? `${base}|${photo}` : base;
  });
}

// ─────────────────────────────────────────────
// 통합: 경기 하나에 대해 위 데이터를 전부 모아서 반환.
// 홈팀 검색 → eventId 특정 → (H2H/최근폼/배당/라인업)을 병렬로 수집.
// ─────────────────────────────────────────────
export async function fetchSofascoreContext({ homeTeamEn, awayTeamEn, matchDateStr, sportName }) {
  const homeTeam = await searchTeamId(homeTeamEn, sportName);
  if (!homeTeam) return null;

  const eventId = await findEventId(homeTeam.id, awayTeamEn, matchDateStr);
  if (!eventId) return null;

  const awayTeam = await searchTeamId(awayTeamEn, sportName);

  const [customId, homeRecent, awayRecent, lineups] = await Promise.all([
    fetchCustomId(eventId).catch(() => null),
    fetchTeamRecent(homeTeam.id).catch(() => []),
    awayTeam ? fetchTeamRecent(awayTeam.id).catch(() => []) : Promise.resolve([]),
    fetchLineups(eventId, sportName).catch(() => null),
  ]);

  const h2h = customId ? await fetchH2hEvents(customId).catch(() => []) : [];

  return {
    eventId,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam?.id ?? null,
    h2h,
    recent: { home: homeRecent, away: awayRecent },
    lineups,
  };
}