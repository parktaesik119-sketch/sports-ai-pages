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
// 라인업 조회 (실측 완료: matchId=2048621, Sabah vs The New Saints, lineupStatus TACTICAL_AVAILABLE)
// - 엔드포인트: match.uefa.com/v5/matches/{matchId}/lineups (인증 불필요)
//   ⚠️ /v5/matches?matchId= 처럼 쿼리스트링이 아니라, matchId가 URL 경로 자체에 들어간다.
//
// ⚠️ 출력 포맷은 _slug_.astro가 기대하는 형식(ESPN 데이터 기준)을 그대로 따라야 한다:
//    - "{이름} ({G|D|M|F})|{사진URL}" — 등번호/주장표시/교체표시 없음
//    - homeLineup/awayLineup 배열은 "선발 11명만" (교체 명단은 넣지 않음, ESPN 컨벤션과 통일)
//    - 배열 순서는 반드시 GK → DF전원 → MF전원 → FW전원 순 (프론트가 이 순서를
//      homeFormation 문자열의 각 줄과 그대로 매칭해서 피치 위에 배치하기 때문)
//    - homeFormation/awayFormation은 배열이 아니라 별도의 평범한 문자열 필드("4-4-2")
// ─────────────────────────────────────────────
const FIELD_POSITION_CODE = {
  GOALKEEPER: 'G',
  DEFENDER: 'D',
  MIDFIELDER: 'M',
  FORWARD: 'F',
};

const POSITION_ORDER = { GOALKEEPER: 0, DEFENDER: 1, MIDFIELDER: 2, FORWARD: 3 };

function formatUefaPlayerLine(entry) {
  const p = entry.player || {};
  const name = p.internationalName || '';
  const code = FIELD_POSITION_CODE[p.fieldPosition] || '';
  const photo = p.imageUrl;
  let line = `${name} (${code})`;
  if (photo) line += `|${photo}`;
  return line;
}

// side.field(선발 11명)만 사용 — 벤치(bench)는 기존 ESPN 컨벤션과 통일하기 위해 제외.
// GK→DF→MF→FW 순으로 재정렬 (원본 UEFA 응답은 이 순서로 안 옴 — 실측 확인됨).
function formatUefaLineupSide(side) {
  if (!side?.field) return [];
  const sorted = [...side.field].sort((a, b) => {
    const oa = POSITION_ORDER[a.player?.fieldPosition] ?? 99;
    const ob = POSITION_ORDER[b.player?.fieldPosition] ?? 99;
    return oa - ob;
  });
  return sorted.map(formatUefaPlayerLine);
}

// "4-4-2" 같은 포메이션 문자열 계산 (골키퍼 제외, DF/MF/FW 각 인원수)
// ⚠️ 세부 라인(예: 진짜 4-2-3-1의 수비형MF/공격형MF 구분)까지는 UEFA 데이터로 구분이
//    안 돼서 미드필더가 전부 한 줄로 뭉뚱그려질 수 있다(예: 4-5-1). 프론트엔드 피치
//    배치에는 인원수만 맞으면 되므로 지장 없음.
function calcUefaFormation(side) {
  if (!side?.field) return '';
  const counts = { DEFENDER: 0, MIDFIELDER: 0, FORWARD: 0 };
  for (const entry of side.field) {
    const pos = entry.player?.fieldPosition;
    if (pos in counts) counts[pos]++;
  }
  return `${counts.DEFENDER}-${counts.MIDFIELDER}-${counts.FORWARD}`;
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