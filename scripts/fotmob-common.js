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

// ─────────────────────────────────────────────
// injuryId(숫자) → 한글 부상 유형 매핑. fotmob 웹페이지엔 "무릎 부상" 같은 구체적
// 텍스트가 뜨지만 API 응답 자체엔 텍스트가 없고 숫자 코드(injuryId)만 있어서,
// 실사용 캡처로 하나씩 확인해서 채워나가는 수동 매핑표다 (공식 문서 없음, 2026-07 확인).
// 모르는 injuryId는 그냥 "부상"으로 뭉뚱그린다.
// ─────────────────────────────────────────────
const INJURY_TYPE_PATH = path.resolve(__dirname, 'fotmob-injury-types.json');
function loadInjuryTypeMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(INJURY_TYPE_PATH, 'utf-8'));
    delete raw._설명;
    return raw;
  } catch {
    return {};
  }
}
const INJURY_TYPE_MAP = loadInjuryTypeMap();

// 별칭 값은 문자열 하나 또는 문자열 배열(한 팀이 fotmob 안에서도 API 종류별로
// 다른 이름을 쓰는 경우 대비 — 실사용으로 확인됨: New York Red Bulls가
// matches 목록 API에선 "NY Red Bulls", teamForm/lineup 쪽에선
// "Red Bull New York"으로 서로 다르게 나옴, 2026-07)
export function matchTeamWithAlias(fotmobName, dbNameEn) {
  if (matchTeam(fotmobName, dbNameEn)) return true;
  const alias = FOTMOB_ALIASES[dbNameEn];
  if (!alias) return false;
  const aliasList = Array.isArray(alias) ? alias : [alias];
  return aliasList.some(a => matchTeam(fotmobName, a));
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

// lineup.{home,away}Team.coach.name → 감독명 (실사용 데이터로 구조 확인, 2026-07)
// lineup.{home,away}Team.coach → "이름|사진url" 형식 (라인업 항목과 동일한 표기 규칙).
// 코치 사진도 선수와 같은 image_resources/playerimages 엔드포인트를 쓰는지는
// 아직 100% 검증 전이라, 사진이 안 뜨면 URL 패턴 자체를 재확인해야 함.
export function extractFotmobCoach(teamLineup) {
  const coach = teamLineup?.coach;
  if (!coach?.name) return null;
  const photo = coach.id ? `https://images.fotmob.com/image_resources/playerimages/${coach.id}.png` : '';
  return photo ? `${coach.name}|${photo}` : coach.name;
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
  const toItems = (list) => (list || []).map(p => {
    const injuryId = p.unavailability?.injuryId;
    const knownType = injuryId != null ? INJURY_TYPE_MAP[String(injuryId)] : null;
    return {
      name: p.name,
      status: knownType || '부상', // 매핑표에 있으면 "무릎 부상" 등 구체적으로, 없으면 뭉뚱그림
      detail: p.unavailability?.expectedReturn || null,
    };
  });
  return {
    home: toItems(lineup?.homeTeam?.unavailable),
    away: toItems(lineup?.awayTeam?.unavailable),
  };
}

// ─────────────────────────────────────────────
// 글 작성 시점(analyze-router-one-git.js의 mergeSoccerMatchSources)용 변환.
// toFotmobH2hDisplay/toFotmobRecentDisplay(위)는 fotmob-lineup-update.js가 사후에
// frontmatter에 직접 써넣는 "26.07.09" 같은 축약 표시용 포맷이라, new Date()로
// 파싱이 안 돼서 mergeSoccerMatchSources에 그대로 못 넣는다. 여기 두 함수는
// 원본 ISO 날짜 + 숫자 homeScore/awayScore로 맞춘 "원본 데이터용" 버전이다.
// ─────────────────────────────────────────────

function splitScoreStr(scoreStr) {
  const parts = (scoreStr || '').split('-').map(s => Number(s.trim()));
  const [homeScore, awayScore] = parts;
  return {
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
  };
}

export function toFotmobH2hRaw(h2h, beforeDateStr) {
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
      date: m.status?.utcTime || m.time?.utcTime, // ISO 원본 그대로
      home: m.home?.name || '',
      away: m.away?.name || '',
      ...splitScoreStr(m.status?.scoreStr),
    }))
    .filter(m => m.date);
}

export function toFotmobRecentRaw(formArr, beforeDateStr) {
  const beforeTs = beforeDateStr ? new Date(beforeDateStr).getTime() : null;
  return (formArr || [])
    .filter(item => {
      if (!beforeTs) return true;
      const t = new Date(item.date?.utcTime).getTime();
      return !Number.isNaN(t) && t < beforeTs;
    })
    .map(item => ({
      date: item.date?.utcTime, // ISO 원본 그대로
      home: item.home?.name || '',
      away: item.away?.name || '',
      homeScore: item.tooltipText?.homeScore != null ? Number(item.tooltipText.homeScore) : null,
      awayScore: item.tooltipText?.awayScore != null ? Number(item.tooltipText.awayScore) : null,
    }))
    .filter(item => item.date);
}