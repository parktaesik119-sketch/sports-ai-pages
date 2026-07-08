// scripts/uefa-common.js
// UEFA 공식 사이트(match.uefa.com)의 비공식이지만 인증 불필요한 v5 API를 이용해
// 챔피언스리그 일정을 조회하고, api-sports 팀명과 UEFA 팀명을 매칭하는 공통 모듈.
//
// ⚠️ 이 API는 브라우저 CORS 헤더가 uefa.com으로 제한돼 있지만, 그건 브라우저에서만
//    강제되는 정책이라 서버(Node.js)에서 fetch()로 호출하는 건 문제없다.
// ⚠️ API 키/토큰/세션 쿠키 전혀 필요 없음 (CPBL과 정반대로 가장 쉬운 케이스).
// ⚠️ 확정 라인업(선발 11명) 엔드포인트는 아직 미확인 상태 — 첫 예선 경기가 시작/종료된
//    이후에 다시 Network 탭을 확인해야 한다. 지금은 일정 조회(matchId 확보)까지만 가능.

const MATCH_API_BASE = 'https://match.uefa.com/v5';

// UEFA 대회 코드 → competitionId (필요시 다른 대항전도 추가 가능)
export const UEFA_COMPETITION_ID = {
  UCL: '1',     // UEFA Champions League
  UECL: '2019', // UEFA Conference League (실측 확인됨)
};

// ─────────────────────────────────────────────
// 팀명 퍼지 매칭
// api-sports가 주는 팀명("Lincoln Red Imps FC")과 UEFA가 주는 internationalName
// ("L. Red Imps")이 서로 다른 표기 방식(약칭/풀네임/발음기호/접미사)을 쓰기 때문에,
// 정확히 일치시키는 대신 "정규화 후 토큰 겹침" 방식으로 매칭한다.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 팀명 별칭 테이블
// 퍼지 매칭(토큰 겹침/편집거리)으로는 절대 못 잡는 예외 케이스를 위한 수동 매핑.
// - 개명: api-sports가 구단 개명을 아직 반영 안 한 경우 (예: Saburtalo → Iberia Tbilisi, 2026년 개명)
// - 이니셜 표기: UEFA.com이 정식명 대신 이니셜만 쓰는 경우 (예: Rīgas FS → RFS)
//   ⚠️ "RFS"는 "Riga FC"(다른 라트비아 클럽, api-sports에선 "Riga")와는 별개의 클럽이므로
//      절대 "Riga"와 혼동해서 별칭 처리하면 안 됨.
// 키/값 모두 normalizeTeamName()을 거친 정규화 문자열로 등록한다.
// ─────────────────────────────────────────────
const TEAM_ALIASES = {
  'saburtalo': 'iberia tbilisi', // Saburtalo Tbilisi → FC Iberia 1999 (2026년 개명, UEFA는 "Iberia Tbilisi")
  'rigas fs': 'rfs',             // Rīgas Futbola skola, UEFA.com은 이니셜만 표기
};

function resolveAlias(normalized) {
  return TEAM_ALIASES[normalized] || normalized;
}

function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // 발음기호(diacritics) 제거 (Győri → Gyori)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // 마침표/어퍼스트로피 등 특수문자 → 공백 (L. → l , d'Escaldes → d escaldes)
    .replace(/\s+/g, ' ')
    .trim();
}

function teamTokens(name) {
  // 3글자 미만 토큰(이니셜 "L", "R." 등)은 노이즈라 제외
  return normalizeTeamName(name).split(' ').filter(t => t.length >= 3);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function teamNamesMatch(a, b) {
  // 별칭 해석을 먼저 적용 (개명/이니셜 표기 등 알고리즘으로 못 잡는 케이스)
  const na = resolveAlias(normalizeTeamName(a));
  const nb = resolveAlias(normalizeTeamName(b));
  if (na && nb && na === nb) return true;
  if (!na || !nb) return false;

  // ⚠️ 토큰화는 반드시 별칭 해석 "이후" 문자열(na/nb)로 해야 한다.
  // 원본 문자열로 토큰화하면 "Riga"(Riga FC)와 "Rīgas FS"(RFS, 다른 클럽)가
  // 편집거리 fallback에서 "riga"↔"rigas"로 오매칭되는 사고가 난다.
  const tokensA = na.split(' ').filter(t => t.length >= 3);
  const tokensB = nb.split(' ').filter(t => t.length >= 3);
  if (!tokensA.length || !tokensB.length) return false;
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  // 짧은 쪽 토큰이 전부 긴 쪽에 있으면 강한 매칭
  if (shorter.every(t => longer.includes(t))) return true;
  // 최소 하나라도 겹치면 약한 매칭 (fallback) — 홈/원정 둘 다 매칭시켜야 하므로 오탐 위험은 낮음
  if (shorter.some(t => longer.includes(t))) return true;
  // 추가 fallback: 스펠링 1~2글자 차이(편집거리)도 같은 팀으로 간주
  // 예: api-sports "Zira" vs UEFA.com "Zire" (표기 방식 차이로 흔히 발생)
  return shorter.some(ts => longer.some(tl => {
    const maxDist = ts.length <= 5 ? 1 : 2;
    return levenshtein(ts, tl) <= maxDist;
  }));
}

// ─────────────────────────────────────────────
// 일정 조회
// fromDate/toDate: 'YYYY-MM-DD' (UTC 기준 날짜)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// H2H(상대전적) 조회
// - 엔드포인트: compstats.uefa.com/v2/team-statistics/head2head?competitionId=&teamId=A,B
//   (인증 불필요, 두 팀의 teamId를 쉼표로 묶어서 요청하면 양쪽 집계를 한 번에 준다)
// - 응답은 팀별 승/무/패/득점 "집계"와, 그 집계에 반영된 과거 matchId 목록만 준다.
//   날짜/스코어 등 개별 경기 상세는 안 주므로, 각 matchId를 /v5/matches?matchId=로
//   다시 조회해서 채운다.
// ⚠️ 실측 확인(matchId 2048621, Sabah vs The New Saints): 1차 예선처럼 두 팀이 처음
//    만나는 라운드에서는 matches_appearance가 항상 "지금 조회 중인 이 경기 자신"만
//    가리키고, 진짜 과거 맞대결은 0건인 게 정상이다. 그래서 excludeMatchId로 현재
//    경기 자신은 h2h 목록에서 제외한다.
// ⚠️ fetchUefaMatchDetail()의 정확한 응답 구조(배열인지 단일 객체인지, score 필드명)는
//    과거 맞대결이 있는 실제 사례로 검증된 적이 없다. 여러 후보 필드명을 방어적으로
//    다 시도하게 짜뒀지만, 나중에 실제 h2h 데이터가 있는 경기가 나오면 한 번 확인 필요.
// ─────────────────────────────────────────────
export async function fetchUefaHeadToHead(competitionId, teamIdA, teamIdB, excludeMatchId) {
  if (!teamIdA || !teamIdB) return [];

  const url = `https://compstats.uefa.com/v2/team-statistics/head2head?competitionId=${competitionId}&teamId=${teamIdA}%2C${teamIdB}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`UEFA h2h 조회 실패: HTTP ${res.status}`);
  const data = await res.json();

  // 두 팀 중 아무 쪽에서나 matches_appearance의 statisticMatchIds를 모으면
  // 두 팀이 실제로 맞붙었던 경기 목록이 된다 (양쪽 다 같은 matchId 목록을 가리킴).
  const matchIds = new Set();
  for (const teamStat of data || []) {
    for (const stat of teamStat.statistics || []) {
      if (stat.name === 'matches_appearance') {
        for (const id of stat.statisticMatchIds || []) matchIds.add(String(id));
      }
    }
  }
  if (excludeMatchId) matchIds.delete(String(excludeMatchId));
  if (matchIds.size === 0) return [];

  const details = await Promise.all(
    [...matchIds].map(id => fetchUefaMatchDetail(id).catch(() => null))
  );

  return details
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5); // 최근 5경기까지만
}

// /v5/matches?matchId= 단건 조회 → h2h용 {date, home, away, score} 형태로 정규화
async function fetchUefaMatchDetail(matchId) {
  const url = `${MATCH_API_BASE}/matches?matchId=${matchId}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`UEFA 경기 상세 조회 실패: HTTP ${res.status}`);
  const raw = await res.json();
  const m = Array.isArray(raw) ? raw[0] : raw;
  if (!m) return null;

  const home = m.homeTeam?.internationalName ?? '';
  const away = m.awayTeam?.internationalName ?? '';
  const dateRaw = m.kickOffTime?.dateTime ?? m.date ?? null;
  const homeGoals = m.score?.total?.home ?? m.score?.home ?? m.homeScore ?? null;
  const awayGoals = m.score?.total?.away ?? m.score?.away ?? m.awayScore ?? null;
  const score = (homeGoals !== null && awayGoals !== null) ? `${homeGoals}-${awayGoals}` : '';

  return {
    date: dateRaw ? String(dateRaw).slice(0, 10) : '',
    home,
    away,
    score,
  };
}

export async function fetchUefaMatches({
  competitionId = UEFA_COMPETITION_ID.UCL,
  fromDate,
  toDate,
  seasonYear = new Date().getFullYear() + 1, // UEFA 시즌은 "종료 연도" 기준 (2026/27 시즌 = 2027)
  utcOffset = 9, // KST
} = {}) {
  const results = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${MATCH_API_BASE}/matches?competitionId=${competitionId}&fromDate=${fromDate}&toDate=${toDate}&limit=${limit}&offset=${offset}&order=ASC&phase=ALL&seasonYear=${seasonYear}&utcOffset=${utcOffset}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`UEFA matches 조회 실패: HTTP ${res.status}`);
    const batch = await res.json();
    results.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return results;
}

// matches: fetchUefaMatches()가 반환한 배열
// homeTeamEn/awayTeamEn: database/{date}.json의 match.home / match.away (api-sports 영문 원문)
export function findUefaMatch(matches, homeTeamEn, awayTeamEn) {
  return matches.find(m =>
    teamNamesMatch(m.homeTeam?.internationalName, homeTeamEn) &&
    teamNamesMatch(m.awayTeam?.internationalName, awayTeamEn)
  )
    // 혹시 홈/원정이 뒤바뀐 데이터가 들어올 경우 대비한 역방향도 확인
    || matches.find(m =>
      teamNamesMatch(m.homeTeam?.internationalName, awayTeamEn) &&
      teamNamesMatch(m.awayTeam?.internationalName, homeTeamEn)
    )
    || null;
}

// match.date(api-sports, UTC ISO) → 'YYYY-MM-DD' (UTC 기준)
// ⚠️ 이건 순수 UTC 날짜 변환용이고, UEFA API 쿼리 파라미터용이 아니다.
export function toUtcDateStr(isoDateStr) {
  return new Date(isoDateStr).toISOString().slice(0, 10);
}

// match.date(api-sports, UTC ISO) → 'YYYY-MM-DD' (KST 기준)
// ⚠️ fetchUefaMatches()의 fromDate/toDate는 utcOffset=9와 함께 쓰이는데, 이때 UEFA API는
//    fromDate/toDate를 "KST 달력 기준 날짜"로 해석한다(실측 확인: 브라우저에서 "Wed 8 Jul"
//    탭을 선택했을 때 캡처된 URL의 fromDate/toDate가 화면에 보이는 KST 날짜 그대로였음).
//    UTC 날짜를 그대로 넣으면 늦은 시간대 킥오프 경기가 조회 범위 밖으로 빠져 매칭 실패가 난다.
export function toKstDateStr(isoDateStr) {
  const kst = new Date(new Date(isoDateStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// 포메이션/줄 구성 계산 (좌표 기반)
// ⚠️ 처음엔 UEFA의 fieldPosition 라벨(GOALKEEPER/DEFENDER/MIDFIELDER/FORWARD) 개수만
//    세는 방식으로 했었는데, 실측해보니 UEFA가 이 라벨을 느슨하게 붙여서(윙백을
//    DEFENDER 대신 MIDFIELDER로 분류하는 등) "2-6-2"처럼 말이 안 되는 포메이션이 나오는
//    사고가 있었다(matchId 2048621, New Saints 실측 확인 — 라벨상 DEFENDER 2명뿐이었지만
//    실제 fieldCoordinate.y는 4명이 정확히 같은 값으로 백4를 이루고 있었음).
//
// 그래서 라벨 대신 각 선수의 fieldCoordinate.y(피치 세로 위치)로 줄을 묶는 방식으로 변경.
// 다만 팀마다 좌표 품질이 다르다(New Saints는 250/500/800처럼 깔끔한 값, Sabah는 186~708
// 사이에 촘촘하게 퍼진 값) — 그대로 두면 Sabah 같은 팀은 5줄 이상으로 과도하게 쪼개질 수
// 있어서, 최대 4줄로 제한하고 간격이 가장 좁은 인접 줄부터 자동으로 합친다.
// ─────────────────────────────────────────────
const ROW_GAP_THRESHOLD = 40; // 이 값 이하 차이는 같은 줄로 간주
const MAX_ROWS = 4;           // DF/MF(/MF)/FW — 표준 포메이션 표기는 보통 4줄을 안 넘음

function classifyOutfieldRows(field) {
  const outfield = (field || [])
    .filter(e => e.player?.fieldPosition !== 'GOALKEEPER')
    .slice()
    .sort((a, b) => (a.fieldCoordinate?.y ?? 0) - (b.fieldCoordinate?.y ?? 0));

  // 1차: y값이 가까운(ROW_GAP_THRESHOLD 이내) 선수끼리 묶어서 줄을 만든다
  const rows = [];
  for (const entry of outfield) {
    const y = entry.fieldCoordinate?.y ?? 0;
    const lastRow = rows[rows.length - 1];
    if (lastRow && y - (lastRow[lastRow.length - 1].fieldCoordinate?.y ?? 0) <= ROW_GAP_THRESHOLD) {
      lastRow.push(entry);
    } else {
      rows.push([entry]);
    }
  }

  // 2차: 줄이 MAX_ROWS를 넘으면, 인접한 줄 중 간격이 가장 좁은 것부터 병합
  while (rows.length > MAX_ROWS) {
    let minGap = Infinity, minIdx = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const gap = (rows[i + 1][0].fieldCoordinate?.y ?? 0) - (rows[i][rows[i].length - 1].fieldCoordinate?.y ?? 0);
      if (gap < minGap) { minGap = gap; minIdx = i; }
    }
    rows[minIdx] = rows[minIdx].concat(rows[minIdx + 1]);
    rows.splice(minIdx + 1, 1);
  }

  // 각 줄 내부는 x좌표(가로 위치) 기준으로 왼쪽→오른쪽 정렬
  rows.forEach(row => row.sort((a, b) => (a.fieldCoordinate?.x ?? 0) - (b.fieldCoordinate?.x ?? 0)));

  return rows;
}

function rowPositionCode(rowIndex, totalRows) {
  if (rowIndex === 0) return 'D';
  if (rowIndex === totalRows - 1) return 'F';
  return 'M';
}

function formatUefaPlayerLine(entry, code) {
  const p = entry.player || {};
  const name = p.internationalName || '';
  const photo = p.imageUrl;
  let line = `${name} (${code})`;
  if (photo) line += `|${photo}`;
  return line;
}

// side.field(선발 11명)만 사용 — 벤치(bench)는 기존 ESPN 컨벤션과 통일하기 위해 제외.
function formatUefaLineupSide(side) {
  if (!side?.field) return [];
  const gk = side.field.find(e => e.player?.fieldPosition === 'GOALKEEPER');
  const rows = classifyOutfieldRows(side.field);
  const lines = [];
  if (gk) lines.push(formatUefaPlayerLine(gk, 'G'));
  rows.forEach((row, i) => {
    const code = rowPositionCode(i, rows.length);
    row.forEach(entry => lines.push(formatUefaPlayerLine(entry, code)));
  });
  return lines;
}

// "4-3-3" 같은 포메이션 문자열 (골키퍼 제외, 좌표 기반 줄 구성)
function calcUefaFormation(side) {
  if (!side?.field) return '';
  const rows = classifyOutfieldRows(side.field);
  return rows.map(r => r.length).join('-');
}

export async function fetchUefaLineup(matchId) {
  const url = `${MATCH_API_BASE}/matches/${matchId}/lineups`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`UEFA 라인업 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  return {
    home: formatUefaLineupSide(data.homeTeam),
    away: formatUefaLineupSide(data.awayTeam),
    homeFormation: calcUefaFormation(data.homeTeam),
    awayFormation: calcUefaFormation(data.awayTeam),
    lineupStatus: data.lineupStatus,
  };
}