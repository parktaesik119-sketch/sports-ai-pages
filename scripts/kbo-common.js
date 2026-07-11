// scripts/kbo-common.js
// KBO 공식 홈페이지(koreabaseball.com)의 비공개 AJAX 웹서비스(/ws/Schedule.asmx)를
// 직접 호출해서 선발투수 분석 / 구종 분석 / 라인업 데이터를 가져오는 공통 로직.
//
// ⚠️ 비공식 엔드포인트이므로 KBO 쪽에서 응답 구조를 예고 없이 바꿀 수 있음.
//    호출 실패/구조 변경 시 이 파일의 파서만 손보면 되도록 파싱 로직을 분리해둠.

const BASE = 'https://koreabaseball.com';
const WS = `${BASE}/ws/Schedule.asmx`;

const COMMON_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Referer': `${BASE}/Schedule/GameCenter/Main.aspx`,
  'Origin': BASE,
};

// ─────────────────────────────────────────────
// 세션 쿠키: 실사용 테스트 결과 없어도 정상 응답을 받는 것으로 확인됨(2026-07-02).
// 혹시 나중에 KBO 쪽에서 세션 검증을 추가하면 다시 필요해질 수 있어
// 함수 자체는 남겨두되, 기본 흐름에서는 호출하지 않는다.
// ─────────────────────────────────────────────
export async function getSessionCookie() {
  const res = await fetch(`${BASE}/Schedule/GameCenter/Main.aspx`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/ASP\.NET_SessionId=[^;]+/i);
  return m ? m[0] : null;
}

async function postWs(method, params, cookie) {
  const body = new URLSearchParams(params).toString();
  const headers = { ...COMMON_HEADERS };
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(`${WS}/${method}`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`${method} 호출 실패: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} 응답 JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────
// 공통: HTML이 섞인 pitcher-cell에서 이름만 뽑기
// ─────────────────────────────────────────────
function extractPitcherName(html) {
  const m = String(html || '').match(/class='name'>([^<]+)</);
  return m ? m[1].trim() : null;
}

// ─────────────────────────────────────────────
// 1. 선발투수 전력분석
// ─────────────────────────────────────────────
export async function fetchPitcherRecordAnalysis(params, cookie) {
  // params: { leId, srId, seasonId, awayTeamId, awayPitId, homeTeamId, homePitId, groupSc }
  const data = await postWs('GetPitcherRecordAnalysis', params, cookie);
  return parsePitcherRecordAnalysis(data);
}

export function parsePitcherRecordAnalysis(data) {
  if (!data?.rows || data.rows.length < 2) return null;
  const headerLabels = (data.headers?.[0]?.row || []).map(h => h.Text);

  function rowToObj(rowWrap) {
    const cells = rowWrap.row;
    const obj = { name: extractPitcherName(cells[0]?.Text) };
    // headerLabels[1..] = 평균자책점, WAR, 경기, 선발평균이닝, QS, WHIP
    const keys = ['era', 'war', 'games', 'inningsPerStart', 'qs', 'whip'];
    keys.forEach((k, i) => { obj[k] = cells[i + 1]?.Text ?? null; });
    return obj;
  }

  // 클래스 접미사 _T(원정/Top) / _B(홈/Bottom) 로도 구분 가능하지만,
  // 요청 파라미터 순서(away 먼저, home 나중)와 응답 rows 순서가 일치하므로 그대로 사용.
  return {
    away: rowToObj(data.rows[0]),
    home: rowToObj(data.rows[1]),
    _headerLabels: headerLabels,
  };
}

// ─────────────────────────────────────────────
// 2. 주요 구종 분석 (투수당 3행: 구종헤더 / 구사비율 / 평균구속)
// ─────────────────────────────────────────────
export async function fetchPitKindAnalysis(params, cookie) {
  // params: { leId, srId, seasonId, awayPitId, homePitId }
  const data = await postWs('GetPitKindAnalysis', params, cookie);
  return parsePitKindAnalysis(data);
}

export function parsePitKindAnalysis(data) {
  const rows = data?.rows || [];
  const pitchers = [];

  for (let i = 0; i + 2 < rows.length + 1 && i < rows.length; i += 3) {
    const headerRow = rows[i]?.row || [];
    const ratioRow  = rows[i + 1]?.row || [];
    const speedRow  = rows[i + 2]?.row || [];
    if (!headerRow.length) break;

    const pitcherName = headerRow[0]?.Text;
    // headerRow[0]=이름, [1]="&nbsp;"(placeholder), [2..]=구종명
    const pitchNames = headerRow.slice(2).map(c => c.Text);
    const ratios = ratioRow.slice(1).map(c => c.Text);
    const speeds = speedRow.slice(1).map(c => c.Text);

    const pitches = pitchNames.map((name, idx) => ({
      type: name,
      usageRate: ratios[idx] ?? null,
      avgSpeed: speeds[idx] ?? null,
    }));

    pitchers.push({ name: pitcherName, pitches });
  }

  // 요청 순서상 away 투수가 먼저, home 투수가 나중에 옴 (awayPitId, homePitId 순서와 동일)
  return {
    away: pitchers[0] || null,
    home: pitchers[1] || null,
  };
}

// ─────────────────────────────────────────────
// 3. 라인업 분석
// ─────────────────────────────────────────────
export async function fetchLineupAnalysis(params, cookie) {
  // params: { leId, srId, seasonId, gameId }
  const data = await postWs('GetLineUpAnalysis', params, cookie);
  return parseLineupAnalysis(data);
}

function parseLineupTable(tableJsonString) {
  if (!tableJsonString) return [];
  let table;
  try {
    table = JSON.parse(tableJsonString);
  } catch {
    return [];
  }
  return (table.rows || []).map(rowWrap => {
    const c = rowWrap.row;
    return {
      order: c[0]?.Text ?? null,
      position: c[1]?.Text ?? null,
      name: c[2]?.Text ?? null,
      war: c[3]?.Text ?? null,
    };
  });
}

export function parseLineupAnalysis(data) {
  if (!Array.isArray(data) || data.length < 5) return null;

  const lineupConfirmed = data[0]?.[0]?.LINEUP_CK === true;
  const homeTeamInfo = data[1]?.[0] || null;
  const awayTeamInfo = data[2]?.[0] || null;
  const homeLineup = parseLineupTable(data[3]?.[0]);
  const awayLineup = parseLineupTable(data[4]?.[0]);

  function teamBlock(info, lineup) {
    if (!info) return null;
    return {
      teamId: info.T_ID,
      teamName: info.T_NM,
      gameId: info.G_ID,
      warByOrderRange: {
        '1-2': info.HITTER_12_WAR_RT,
        '3-5': info.HITTER_35_WAR_RT,
        '6-9': info.HITTER_69_WAR_RT,
      },
      lineup,
    };
  }

  return {
    lineupConfirmed, // false면 "예상" 라인업, true면 실제 확정 라인업
    home: teamBlock(homeTeamInfo, homeLineup),
    away: teamBlock(awayTeamInfo, awayLineup),
  };
}

// ─────────────────────────────────────────────
// 0. 오늘(또는 지정일) 경기 목록 — 일정 + 예상 선발투수 + 팀 순위까지 한 번에 옴
// ─────────────────────────────────────────────
const MAIN_WS = `${BASE}/ws/Main.asmx`;

async function postMainWs(method, params, cookie) {
  const body = new URLSearchParams(params).toString();
  const headers = { ...COMMON_HEADERS };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${MAIN_WS}/${method}`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`${method} 호출 실패: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} 응답 JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

// date: 'YYYYMMDD' 문자열 (KST 기준)
export async function fetchKboGameList(date, { leId = 1, srId = '0,1,3,4,5,6,7,8,9' } = {}, cookie) {
  const data = await postMainWs('GetKboGameList', { leId, srId, date }, cookie);
  return parseKboGameList(data);
}

export function parseKboGameList(data) {
  return (data?.game || []).map(g => ({
    gameId: g.G_ID,
    date: g.G_DT,
    time: g.G_TM,
    stadium: g.S_NM,
    leId: g.LE_ID,
    srId: g.SR_ID,
    seasonId: g.SEASON_ID,
    gameState: g.GAME_STATE_SC,       // "1" = 경기 전으로 추정 (진행/종료 상태값은 실제 라이브 경기로 추가 확인 필요)
    cancelStatus: g.CANCEL_SC_NM,     // "정상경기" 외의 값이면 우천취소 등
    away: {
      id: g.AWAY_ID,
      name: g.AWAY_NM,
      rank: g.T_RANK_NO,
      starterId: g.T_PIT_P_ID || null,
      starterName: (g.T_PIT_P_NM || '').trim() || null,
    },
    home: {
      id: g.HOME_ID,
      name: g.HOME_NM,
      rank: g.B_RANK_NO,
      starterId: g.B_PIT_P_ID || null,
      starterName: (g.B_PIT_P_NM || '').trim() || null,
    },
  }));
}

// ─────────────────────────────────────────────
// 통합: 특정 날짜의 모든 경기에 대해 선발투수분석/구종분석/라인업을 한 번에 수집
// ─────────────────────────────────────────────
export async function fetchKboDayPreviews(date) {
  const games = await fetchKboGameList(date, {});

  const results = [];
  for (const g of games) {
    if (g.cancelStatus && g.cancelStatus !== '정상경기') {
      results.push({ ...g, skipped: true, reason: g.cancelStatus });
      continue;
    }
    if (!g.away.starterId || !g.home.starterId) {
      // 선발투수 미발표 상태 — 투수 분석/구종 분석은 스킵하고 라인업만 시도
      const lineup = await fetchLineupAnalysis(
        { leId: g.leId, srId: g.srId, seasonId: g.seasonId, gameId: g.gameId }
      ).catch(() => null);
      results.push({ ...g, pitcherRecord: null, pitKind: null, lineup });
      continue;
    }

    const [pitcherRecord, pitKind, lineup] = await Promise.all([
      fetchPitcherRecordAnalysis({
        leId: g.leId, srId: g.srId, seasonId: g.seasonId,
        awayTeamId: g.away.id, awayPitId: g.away.starterId,
        homeTeamId: g.home.id, homePitId: g.home.starterId,
        groupSc: 'SEASON',
      }).catch(() => null),
      fetchPitKindAnalysis({
        leId: g.leId, srId: g.srId, seasonId: g.seasonId,
        awayPitId: g.away.starterId, homePitId: g.home.starterId,
      }).catch(() => null),
      fetchLineupAnalysis({
        leId: g.leId, srId: g.srId, seasonId: g.seasonId, gameId: g.gameId,
      }).catch(() => null),
    ]);

    results.push({ ...g, pitcherRecord, pitKind, lineup });
  }
  return results;
}

// ─────────────────────────────────────────────
// 팀명 매핑: team_name_map.js의 영문 키(api-sports 등에서 오는 형태) → KBO 공식 팀코드
// ESPN 쪽과 달리 KBO는 코드가 고정돼 있어 퍼지 매칭 없이 정확히 대조 가능.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 선수 사진 URL (koreabaseball.com 선수 상세페이지에서 실측 확인한 패턴)
// 예: https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/2026/53764.jpg
// 별도 API 호출 없이 playerId만으로 조립 가능 (선발투수 ID는 fetchKboGameList에서 이미 확보됨)
// ⚠️ 신인 등 사진이 아직 없는 선수는 깨진 이미지일 수 있음 - 프론트에서 onError 처리 권장
//    (기존 코드에 이미 onError="this.style.display='none'" 있으므로 별도 조치 불필요)
// ─────────────────────────────────────────────
export function getKboPlayerPhotoUrl(playerId, year = new Date().getFullYear()) {
  if (!playerId) return null;
  return `https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/${year}/${playerId}.jpg`;
}

export const KBO_TEAM_CODE_MAP = {
  'Doosan Bears': 'OB',
  'Hanwha Eagles': 'HH',
  'KIA Tigers': 'HT',
  'KT Wiz Suwon': 'KT',
  'Kiwoom Heroes': 'WO',
  'LG Twins': 'LG',
  'Lotte Giants': 'LT',
  'NC Dinos': 'NC',
  'SSG Landers': 'SK',
  'Samsung Lions': 'SS',
};

// games: fetchKboGameList()가 반환한 배열
// homeTeamEn/awayTeamEn: database/{date}.json의 match.home / match.away (영문 원문)
export function findKboGame(games, homeTeamEn, awayTeamEn) {
  const homeCode = KBO_TEAM_CODE_MAP[homeTeamEn];
  const awayCode = KBO_TEAM_CODE_MAP[awayTeamEn];
  if (!homeCode || !awayCode) return null;

  return games.find(g => g.home.id === homeCode && g.away.id === awayCode)
    // 혹시 홈/원정이 뒤바뀐 데이터가 들어올 경우 대비한 역방향도 확인
    || games.find(g => g.home.id === awayCode && g.away.id === homeCode)
    || null;
}


export async function fetchKboGamePreview({
  leId = 1, srId = 0, seasonId, gameId,
  awayTeamId, awayPitId, homeTeamId, homePitId,
}) {
  const [pitcherRecord, pitKind, lineup] = await Promise.all([
    fetchPitcherRecordAnalysis(
      { leId, srId, seasonId, awayTeamId, awayPitId, homeTeamId, homePitId, groupSc: 'SEASON' }
    ),
    fetchPitKindAnalysis({ leId, srId, seasonId, awayPitId, homePitId }),
    fetchLineupAnalysis({ leId, srId, seasonId, gameId }),
  ]);

  return { pitcherRecord, pitKind, lineup };
}

// ─────────────────────────────────────────────
// 5. 선수 이동 현황 - 부상자 명단(bdSc=18) / 치료·재활명단(bdSc=21)
//
// koreabaseball.com/ws/Player.asmx/GetTradeList — 브라우저 네트워크 캡처로 확인한
// 비공개 엔드포인트(2026-07-11 실사용 테스트 기준). "선수 이동 현황" 페이지가
// 이 엔드포인트로 항목(bdSc)별 이동 이력을 조회한다.
//
// ⚠️ 이 API는 "현재 결장 중"인 선수 목록이 아니라 시즌 전체 등재 이력 로그다.
//    비고(note)에 적힌 등재 일수(예: "10일", "30일")를 등재일(date)에 더해
//    만료일을 계산하고, 오늘이 그 안에 있는 선수만 "현재 결장 중"으로 추정한다.
// ─────────────────────────────────────────────
const PLAYER_WS = `${BASE}/ws/Player.asmx`;

async function postPlayerWs(method, params, cookie) {
  const body = new URLSearchParams(params).toString();
  const headers = { ...COMMON_HEADERS };
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(`${PLAYER_WS}/${method}`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`${method} 호출 실패: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} 응답 JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

// bdSc: 18 = 부상자 명단, 21 = 치료·재활명단
// teamName을 비워두면 전체 팀 결과가 한 번에 오므로, 하루 단위로 한 번만 호출하고
// 이후 팀별 필터링은 로컬에서 처리하는 편이 API 호출 횟수를 줄일 수 있다.
export async function fetchTradeList({ seasonId, bdSc, teamName = '', monthId = '0', pageNo = 1, listCount = 300 }, cookie) {
  const data = await postPlayerWs('GetTradeList', { seasonId, monthId, bdSc, teamName, searchIf: '', pageNo, listCount }, cookie);
  return parseTradeList(data);
}

export function parseTradeList(data) {
  if (!data?.rows) return [];
  return data.rows.map(rowWrap => {
    const c = rowWrap.row;
    return {
      date: c[0]?.Text ?? null,     // 'YYYY-MM-DD' 등재일
      category: c[1]?.Text ?? null, // '부상자 명단' | '치료·재활명단'
      team: c[2]?.Text ?? null,     // 짧은 한글 팀명 (예: '삼성')
      player: c[3]?.Text ?? null,   // '이름(포지션)' 형태
      note: c[4]?.Text ?? null,     // '10일', '30일', '10일/7.5군 엔트리등록' 등
    };
  });
}

// 짧은 한글 팀명("삼성") → KBO_TEAM_CODE_MAP과 동일한 코드("SS")
export const KBO_SHORT_NAME_TO_CODE = {
  '두산': 'OB',
  '한화': 'HH',
  'KIA': 'HT',
  'KT': 'KT',
  '키움': 'WO',
  'LG': 'LG',
  '롯데': 'LT',
  'NC': 'NC',
  'SSG': 'SK',
  '삼성': 'SS',
};

// note에서 등재 일수(정수) 추출. "10일/7.5군 엔트리등록"처럼 뒤에 다른 문구가 붙어도
// 맨 앞 "N일" 패턴만 잡는다. 못 찾으면 null.
function extractDurationDays(note) {
  const m = String(note || '').match(/(\d+)\s*일/);
  return m ? parseInt(m[1], 10) : null;
}

// entry.date(등재일, KST) + 등재 일수로 만료일을 계산해 오늘 기준 아직 유효한지 판단.
// 비고에 일수가 없는 경우(빈 값)는 KBO 부상자명단 최소 등재기간인 10일로 보수적으로 처리.
function isStillActive(entry, todayStr) {
  const days = extractDurationDays(entry.note) ?? 10;
  const regDate = new Date(`${entry.date}T00:00:00+09:00`);
  const expiry = new Date(regDate.getTime() + days * 24 * 60 * 60 * 1000);
  const today = new Date(`${todayStr}T00:00:00+09:00`);
  return today <= expiry;
}

// 부상자 명단(18) + 치료·재활명단(21)을 합쳐 시즌 전체 이력을 한 번에 가져온다.
// (하루 수집 배치당 1회만 호출하고 fetch-kbo-context.js에서 팀별로 재사용할 것)
export async function fetchAllInjuryAndRehabEntries(seasonId, cookie) {
  const [injuries, rehab] = await Promise.all([
    fetchTradeList({ seasonId, bdSc: 18 }, cookie),
    fetchTradeList({ seasonId, bdSc: 21 }, cookie),
  ]);
  return [...injuries, ...rehab];
}

// allEntries(fetchAllInjuryAndRehabEntries 결과)에서 특정 팀코드의 "현재 결장 중" 선수만 추림.
// 같은 선수가 시즌 중 여러 번 등재/복귀를 반복했을 수 있으므로, 선수별로 가장 최근 등재
// 1건만 남긴 뒤 그 기록이 아직 만료 전인지를 판단한다(최신 기록이 그 선수의 최신 상태를 반영).
export function getActiveInjuriesForTeam(allEntries, teamCode, todayStr) {
  const teamEntries = allEntries.filter(e => KBO_SHORT_NAME_TO_CODE[e.team] === teamCode);

  const latestByPlayer = {};
  for (const e of teamEntries) {
    if (!e.player) continue;
    if (!latestByPlayer[e.player] || e.date > latestByPlayer[e.player].date) {
      latestByPlayer[e.player] = e;
    }
  }

  return Object.values(latestByPlayer)
    .filter(e => isStillActive(e, todayStr))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}