// scripts/kbl-common.js
// KBL 공식 홈페이지(www.kbl.or.kr)가 내부적으로 쓰는 api.kbl.or.kr REST API를
// 직접 호출해서 일정/출전선수(선발여부 포함) 데이터를 가져오는 공통 로직.
//
// ⚠️ 비공식 엔드포인트이므로 KBL 쪽에서 응답 구조를 예고 없이 바꿀 수 있음.
//    호출 실패/구조 변경 시 이 파일의 파서만 손보면 되도록 파싱 로직을 분리해둠.
//
// ⚠️ KBO(예상 선발)와 달리, KBL은 "경기 전 라인업 사전공개" 자체가 없는 리그다.
//    player-stat 엔드포인트는 실제 출전 기록(득점, 리바운드 등)과 함께
//    startFlag(선발 여부)를 내려주는데, 이 값은 경기가 실제로 시작된 뒤에만
//    의미 있는 값으로 채워진다. 즉 이 모듈은 "경기 전 예상 라인업" 조회용이
//    아니라, espn-boxscore-update.js처럼 "경기 시작/종료 후 갱신"용으로 써야 한다.

const API_BASE = 'https://api.kbl.or.kr';

const COMMON_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.kbl.or.kr',
  'Referer': 'https://www.kbl.or.kr/',
};

async function getJson(url) {
  const res = await fetch(url, { headers: COMMON_HEADERS });
  if (!res.ok) throw new Error(`요청 실패: HTTP ${res.status} (${url})`);
  return res.json();
}

// ─────────────────────────────────────────────
// 1. 기간별 경기 목록
// date: 'YYYYMMDD' 문자열 (KST 기준). 하루치만 조회할 땐 from===to로 호출.
// ─────────────────────────────────────────────
export async function fetchKblGameList(dateFrom, dateTo = dateFrom) {
  const url = `${API_BASE}/match/list?fromDate=${dateFrom}&toDate=${dateTo}&tcodeList=all`;
  const data = await getJson(url);
  return parseKblGameList(data);
}

export function parseKblGameList(data) {
  return (Array.isArray(data) ? data : []).map(g => ({
    gmkey: g.gmkey,               // player-stat 호출에 그대로 사용하는 키 (예: "S47G01N133")
    date: g.gameDate,             // 'YYYYMMDD'
    startTime: g.gameStart,       // 'HHMM'
    endTime: g.gameEnd || null,
    stadium: g.stadiumname,
    seasonCode: g.seasonCode,
    seasonCategory: g.seasonCategory,       // 'R'=정규시즌, 'D1'=D리그, 'AS'=올스타, 'EA'=EASL 등
    seasonCategoryName: g.seasonCategoryName,
    isStarted: g.isStarted === 1,
    isEnded: g.isEnded === 1,
    home: {
      tcode: g.tcodeH,
      name: g.tnameH,
      fullName: g.tnameFH,
      score: g.scoreH,
    },
    away: {
      tcode: g.tcodeA,
      name: g.tnameA,
      fullName: g.tnameFA,
      score: g.scoreA,
    },
  }));
}

// ─────────────────────────────────────────────
// 2. 경기별 선수기록 (출전선수 전원 + 선발 여부)
// ─────────────────────────────────────────────
export async function fetchKblPlayerStat(gmkey) {
  const url = `${API_BASE}/match/${gmkey}/player-stat`;
  const data = await getJson(url);
  return parseKblPlayerStat(data);
}

export function parseKblPlayerStat(data) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const home = [];
  const away = [];

  for (const row of data) {
    const p = row.player || {};
    const entry = {
      pcode: p.pcode,
      name: p.pname,
      nameEn: p.ename,
      backNum: p.backNum,
      pos: p.pos,
      teamCode: p.tcode,
      teamName: p.tname,
      // playerFlag: '0'=국내, '1'=외국인, '2'=아시아쿼터로 추정 (실사용 확인 필요)
      playerFlag: p.playerFlag,
      photoUrl: p.img || null,
      isStarter: row.startFlag === 1,
      playMin: row.records?.playMin ?? null,
      playSec: row.records?.playSec ?? null,
      score: row.records?.score ?? null,
    };
    // homeAway: "1"=홈, "2"=원정
    if (row.homeAway === '1') home.push(entry);
    else if (row.homeAway === '2') away.push(entry);
  }

  return {
    home: {
      teamName: home[0]?.teamName ?? null,
      teamCode: home[0]?.teamCode ?? null,
      starters: home.filter(p => p.isStarter),
      bench: home.filter(p => !p.isStarter),
    },
    away: {
      teamName: away[0]?.teamName ?? null,
      teamCode: away[0]?.teamCode ?? null,
      starters: away.filter(p => p.isStarter),
      bench: away.filter(p => !p.isStarter),
    },
  };
}

// ─────────────────────────────────────────────
// 3. 최근 폼 / 상대전적
// ⚠️ KBL은 겨울 시즌제라(비시즌엔 경기 자체가 없음), 고정된 날짜 범위로
//    조회하면 비시즌 직후엔 경기가 하나도 안 잡힐 수 있다. 그래서 원하는
//    경기 수를 채울 때까지 조회 범위를 점점 넓혀가는 방식으로 구현함
//    (필요하면 지난 시즌까지 자동으로 거슬러 올라감).
// ─────────────────────────────────────────────
const EXPANDING_WINDOWS_DAYS = [45, 120, 270, 400]; // 400일이면 사실상 지난 시즌까지 커버

function subtractDaysFromDateCode(dateCode, days) {
  // dateCode: 'YYYYMMDD'
  const y = Number(dateCode.slice(0, 4));
  const m = Number(dateCode.slice(4, 6)) - 1;
  const d = Number(dateCode.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

// 'YYYYMMDD' -> 'YYYY-MM-DD'. analyze-router-one-git.js 등 나머지 파이프라인이
// 전부 new Date()로 바로 파싱 가능한 ISO 날짜를 기대하기 때문에, KBL 고유의
// YYYYMMDD 표기는 바깥으로 나가기 전에(=recentForm/headToHead 반환값) 여기서 변환한다.
function dateCodeToIso(dateCode) {
  return `${dateCode.slice(0, 4)}-${dateCode.slice(4, 6)}-${dateCode.slice(6, 8)}`;
}

// beforeDateCode(포함) 이전 경기들 중, 종료된(isEnded) 경기만 최신순으로 최대 count개.
// tcode가 주어지면 해당 팀이 낀 경기만, 없으면 전체.
async function fetchRecentEndedGames(beforeDateCode, { tcode = null, count = 5 } = {}) {
  for (const windowDays of EXPANDING_WINDOWS_DAYS) {
    const fromDateCode = subtractDaysFromDateCode(beforeDateCode, windowDays);
    const games = await fetchKblGameList(fromDateCode, beforeDateCode).catch(() => []);

    const filtered = games
      .filter(g => g.isEnded)
      .filter(g => !tcode || g.home.tcode === tcode || g.away.tcode === tcode)
      // 날짜+시작시각 기준 최신순 정렬
      .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));

    if (filtered.length >= count || windowDays === EXPANDING_WINDOWS_DAYS.at(-1)) {
      return filtered.slice(0, count);
    }
  }
  return [];
}

// 특정 팀의 최근 폼 (최근 count경기 승/패 + 스코어)
export async function fetchKblRecentForm(tcode, beforeDateCode, count = 5) {
  const games = await fetchRecentEndedGames(beforeDateCode, { tcode, count });
  return games.map(g => {
    const isHome = g.home.tcode === tcode;
    const my = isHome ? g.home : g.away;
    const opp = isHome ? g.away : g.home;
    const won = my.score > opp.score;
    return {
      date: dateCodeToIso(g.date),
      opponent: opp.name,
      isHome,
      myScore: my.score,
      oppScore: opp.score,
      result: won ? 'W' : 'L',
    };
  });
}

// 두 팀의 최근 맞대결 (상대전적)
export async function fetchKblHeadToHead(tcodeA, tcodeB, beforeDateCode, count = 5) {
  // 넓게 뽑은 뒤(팀A 기준) 상대가 팀B인 경기만 다시 필터링.
  // 맞대결은 자주 없어서, 필요한 개수를 못 채우면 마지막 윈도우(400일)까지 그대로 감.
  for (const windowDays of EXPANDING_WINDOWS_DAYS) {
    const fromDateCode = subtractDaysFromDateCode(beforeDateCode, windowDays);
    const games = await fetchKblGameList(fromDateCode, beforeDateCode).catch(() => []);

    const filtered = games
      .filter(g => g.isEnded)
      .filter(g =>
        (g.home.tcode === tcodeA && g.away.tcode === tcodeB) ||
        (g.home.tcode === tcodeB && g.away.tcode === tcodeA)
      )
      .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));

    if (filtered.length >= count || windowDays === EXPANDING_WINDOWS_DAYS.at(-1)) {
      return filtered.slice(0, count).map(g => ({
        date: dateCodeToIso(g.date),
        home: g.home.name,
        away: g.away.name,
        homeScore: g.home.score,
        awayScore: g.away.score,
      }));
    }
  }
  return [];
}

// 참고: 선수 사진 URL은 player-stat 응답에 이미 완전한 형태로 들어있어서
// (예: https://kbl.or.kr/files/kbl/players-photo/290524.png) 별도 조립이 필요 없음.

// ─────────────────────────────────────────────
// 팀명 매핑: team_name_map.js의 영문 키(api-sports 등에서 오는 형태) → KBL tcode
// tcode는 전부 match/list 응답에서 실측한 값 (2026-01 시즌 데이터 기준).
// 같은 팀에 별칭이 여러 개 있는 건(예: Suwon KT / KT Sonicboom / Suwon KT Sonicboom)
// api-sports 등 소스마다 표기가 달라서 여러 키로 들어올 수 있기 때문 — 전부 매핑해둠.
// ─────────────────────────────────────────────
export const KBL_TEAM_CODE_MAP = {
  'Anyang JungKwanJang': '70',
  'Goyang Sono': '66',
  'KCC Egis': '60',
  'LG Sakers': '50',
  'Daegu KOGAS': '64',
  'SK Knights': '55',
  'Samsung Thunders': '35',
  'Changwon LG': '50',
  'Ulsan Hyundai Mobis': '10',
  'Hyundai Mobis': '10',
  'Suwon KT': '06',
  'KT Sonicboom': '06',
  'Suwon KT Sonicboom': '06',
  'Wonju DB': '16',
  'DB Promy': '16',
};

// games: fetchKblGameList()가 반환한 배열
// homeTeamEn/awayTeamEn: database/{date}.json의 match.home / match.away (영문 원문)
export function findKblGame(games, homeTeamEn, awayTeamEn) {
  const homeCode = KBL_TEAM_CODE_MAP[homeTeamEn];
  const awayCode = KBL_TEAM_CODE_MAP[awayTeamEn];
  if (!homeCode || !awayCode) return null;

  return games.find(g => g.home.tcode === homeCode && g.away.tcode === awayCode)
    // 혹시 홈/원정이 뒤바뀐 데이터가 들어올 경우 대비한 역방향도 확인
    || games.find(g => g.home.tcode === awayCode && g.away.tcode === homeCode)
    || null;
}

// match.date(UTC ISO 문자열) → KST 기준 'YYYYMMDD'
export function toKstDateCode(isoDateStr) {
  const kst = new Date(new Date(isoDateStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}