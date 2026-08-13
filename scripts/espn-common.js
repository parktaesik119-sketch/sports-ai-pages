// scripts/espn-common.js
// ESPN site API 호출 관련 공통 로직.
// espn-boxscore-update.js(라인업)와 espn-context-fetch.js(순위/결장자)가 공유합니다.
// matchTeam()은 이 파일뿐 아니라 fotmob-common.js, analyze-router-one-git.js 등
// 팀명 비교가 필요한 거의 모든 곳에서 공용으로 쓰인다.

import TEAM_NAME_MAP from './team_name_map.js';

// ─────────────────────────────────────────────
// 종목별 ESPN API 설정
// (axn 배구는 ESPN 공개 API에 사실상 커버리지가 없어 제외함 — 필요시 web_search 유지)
// ─────────────────────────────────────────────
export const ESPN_SPORTS = {
  baseball:           { sport: 'baseball',   league: 'mlb',            label: 'MLB'             },
  basketball:         { sport: 'basketball', league: 'nba',            label: 'NBA'             },
  basketball_summer_utah:       { sport: 'basketball', league: 'nba-summer-utah',       label: 'NBA 썸머리그(솔트레이크)' },
  basketball_summer_lasvegas:   { sport: 'basketball', league: 'nba-summer-las-vegas',  label: 'NBA 썸머리그(라스베가스)' },
  basketball_summer_orlando:    { sport: 'basketball', league: 'nba-summer-orlando',    label: 'NBA 썸머리그(올랜도)' },
  basketball_summer_sacramento: { sport: 'basketball', league: 'nba-summer-sacramento', label: 'NBA 썸머리그(새크라멘토)' },
  wnba:               { sport: 'basketball', league: 'wnba',           label: 'WNBA'            },
  hockey:             { sport: 'hockey',     league: 'nhl',            label: 'NHL'             },
  soccer_mls:         { sport: 'soccer',     league: 'usa.1',          label: 'MLS'             },
  soccer_laliga:      { sport: 'soccer',     league: 'esp.1',          label: '라리가'          },
  soccer_bundesliga:  { sport: 'soccer',     league: 'ger.1',          label: '분데스리가'      },
  soccer_bundesliga2: { sport: 'soccer',     league: 'ger.2',          label: '분데스리가2'     },
  soccer_primeira:    { sport: 'soccer',     league: 'por.1',          label: '프리메라리가'    },
  soccer_ucl:         { sport: 'soccer',     league: 'uefa.champions', label: 'UEFA 챔피언스리그' },
  soccer_ucl_qual:    { sport: 'soccer',     league: 'uefa.champions_qual', label: 'UEFA 챔피언스리그 예선' },
  soccer_uel:         { sport: 'soccer',     league: 'uefa.europa',    label: 'UEFA 유로파리그' },
  soccer_uel_qual:    { sport: 'soccer',     league: 'uefa.europa_qual', label: 'UEFA 유로파리그 예선' },
  soccer_worldcup:    { sport: 'soccer',     league: 'fifa.world',     label: 'FIFA 월드컵'      },
  soccer_epl:         { sport: 'soccer',     league: 'eng.1',          label: 'P.L'             },
  soccer_seriea:      { sport: 'soccer',     league: 'ita.1',          label: '세리에 A'        },
  soccer_ligue1:      { sport: 'soccer',     league: 'fra.1',          label: '리그1'           },
  soccer_eredivisie:  { sport: 'soccer',     league: 'ned.1',          label: '에레디비시'      },
  soccer_kleague:     { sport: 'soccer',     league: 'kor.1',          label: 'K1'              },
  soccer_uruguay:     { sport: 'soccer',     league: 'uru.1',          label: '프리메라디비전'  },
  soccer_libertadores:{ sport: 'soccer',     league: 'conmebol.libertadores', label: '코파 리베르타도레스' },
  soccer_sudamericana:{ sport: 'soccer',     league: 'conmebol.sudamericana', label: '코파 수다메리카나'   },
  soccer_laliga2:     { sport: 'soccer',     league: 'esp.2',          label: '라리가2'         },
  soccer_uecl:        { sport: 'soccer',     league: 'uefa.europa.conf', label: 'UEFA 컨퍼런스리그' },
  soccer_uecl_qual:   { sport: 'soccer',     league: 'uefa.europa.conf_qual', label: 'UEFA 컨퍼런스리그 예선' },
  soccer_nations:     { sport: 'soccer',     league: 'uefa.nations',   label: '네이션스리그'     },
  soccer_nations_w:   { sport: 'soccer',     league: 'uefa.w.nations', label: '네이션스리그(W)'  },
  soccer_wwc:         { sport: 'soccer',     league: 'fifa.wwc',       label: '월드컵 (W)'      },
  soccer_afc_asiancup:{ sport: 'soccer',     league: 'afc.asian.cup',  label: 'AFC 아시안컵'     },
  soccer_friendly:    { sport: 'soccer',     league: 'fifa.friendly',  label: '국제친선'         },
  // "D1"이라는 한글 라벨을 여러 나라가 공유해서(벨기에/아일랜드/기타) country로 최종 구분한다.
  soccer_belgium:     { sport: 'soccer',     league: 'bel.1',          label: 'D1(벨기에)'       },
  soccer_ireland:     { sport: 'soccer',     league: 'irl.1',          label: 'D1(아일랜드)'     },
};

// analyze-router-one-git.js의 cat('soccer'|'basketball'|'baseball'|'hockey'|'volleyball'|'lol')과
// match.league(영문 원문 또는 변환된 한글 라벨) 기준으로 ESPN_SPORTS 키를 찾습니다.
// country: api-sports 등에서 제공하는 국가명 (예: 'England', 'Spain'). 동명 리그(예: 부탄/레바논/쿠웨이트도
// 전부 "Premier League"라는 이름을 씀) 오매칭을 막기 위해 country 검증이 필요한 리그는 명시적으로 확인한다.
const COUNTRY_REQUIRED = {
  soccer_mls:        ['USA', 'United States'],
  soccer_laliga:      ['Spain'],
  soccer_bundesliga:  ['Germany'],
  soccer_bundesliga2: ['Germany'],
  soccer_primeira:    ['Portugal'],
  soccer_epl:         ['England'],
  soccer_seriea:      ['Italy'],
  soccer_ligue1:      ['France'],
  soccer_eredivisie:  ['Netherlands'],
  soccer_kleague:     ['South Korea', 'Korea Republic', 'Korea'],
  soccer_uruguay:     ['Uruguay'],
  soccer_laliga2:     ['Spain'],
  soccer_belgium:     ['Belgium'],
  soccer_ireland:     ['Ireland', 'Republic of Ireland'],
  // CONMEBOL 대회/UEFA 대륙대회/국제대회는 국가 제한 없음 (COUNTRY_REQUIRED에 미등록 = 제한 없음)
};

function countryOk(key, country) {
  const required = COUNTRY_REQUIRED[key];
  if (!required) return true; // UCL/UEL/World Cup 등 국가 제한 없는 국제대회
  if (!country) return false; // country 정보가 없으면 안전하게 거부
  return required.some(c => c.toLowerCase() === String(country).toLowerCase());
}

export function detectEspnSport(category, league, country, matchDate) {
  const cat = (category || '').toLowerCase();
  const lg  = (league   || '').toUpperCase();
  // UCL/UEL/UECL 예선은 항상 6~8월에 열리고, 본선(조별/리그 스테이지)은 9월에야 시작한다.
  // api-sports의 league 필드는 예선/본선을 구분하는 단어를 안 주기 때문에(둘 다 그냥
  // "UEFA Champions League"), 문자열만으로는 절대 구분이 안 되고 날짜로 판별해야 한다.
  const isUefaQualSeason = (() => {
    if (!matchDate) return false;
    const m = new Date(matchDate).getUTCMonth() + 1; // 1~12
    return m >= 6 && m <= 8;
  })();

  if (lg.includes('WNBA') || lg === 'NBA W')         return 'wnba';
  // NBA 썸머리그는 정규시즌(nba)과 ESPN 리그 코드 자체가 달라서 먼저 걸러내야 함
  if (cat === 'basketball' && (lg.includes('SUMMER LEAGUE') || lg.includes('CALIFORNIA CLASSIC'))) {
    if (lg.includes('SALT LAKE') || lg.includes('UTAH'))  return 'basketball_summer_utah';
    if (lg.includes('SACRAMENTO') || lg.includes('CALIFORNIA CLASSIC')) return 'basketball_summer_sacramento';
    if (lg.includes('ORLANDO'))                           return 'basketball_summer_orlando';
    return 'basketball_summer_lasvegas'; // 도시 특정 안 되면 참가 팀이 가장 많은 라스베가스로 기본 처리
  }
  if (cat === 'basketball' && lg.includes('NBA'))    return 'basketball';
  if (cat === 'baseball'   && lg.includes('MLB'))    return 'baseball';
  if (cat === 'hockey'     && lg.includes('NHL'))    return 'hockey';

  if (cat === 'soccer') {
    let key = null;
    if (lg === 'MLS' || lg === 'MAJOR LEAGUE SOCCER')                 key = 'soccer_mls';
    else if (lg.includes('라리가') && !lg.includes('라리가2'))        key = 'soccer_laliga';
    else if (lg === 'LA LIGA')                                        key = 'soccer_laliga';
    else if (lg.includes('분데스리가2') || lg.includes('2. BUNDESLIGA')) key = 'soccer_bundesliga2';
    else if ((lg.includes('분데스리가') && !lg.includes('분데스리가2')) || lg === 'BUNDESLIGA') key = 'soccer_bundesliga';
    else if (lg.includes('프리메라리가') || lg === 'PRIMEIRA LIGA')    key = 'soccer_primeira';
    else if (lg.includes('UEFA 챔피언스리그') || lg === 'UEFA CHAMPIONS LEAGUE') {
      key = isUefaQualSeason ? 'soccer_ucl_qual' : 'soccer_ucl';
    }
    else if (lg.includes('UEFA 컨퍼런스리그') || lg.includes('UEFA EUROPA CONFERENCE')) {
      key = isUefaQualSeason ? 'soccer_uecl_qual' : 'soccer_uecl';
    }
    else if (lg.includes('UEFA 유로파리그') || lg === 'UEFA EUROPA LEAGUE') {
      key = isUefaQualSeason ? 'soccer_uel_qual' : 'soccer_uel';
    }
    else if (lg.includes('FIFA 월드컵') || (lg.includes('WORLD CUP') && !lg.includes('WOMEN') && !lg.includes('QUALIF'))) key = 'soccer_worldcup';
    else if (lg.includes('P.L') || lg === 'PREMIER LEAGUE')           key = 'soccer_epl';
    else if (lg.includes('세리에 A') || lg === 'SERIE A')             key = 'soccer_seriea';
    else if (lg.includes('리그1') || lg === 'LIGUE 1')                key = 'soccer_ligue1';
    else if (lg.includes('에레디비시') || lg === 'EREDIVISIE')        key = 'soccer_eredivisie';
    // 우루과이 리그는 시즌 전반기/후반기에 따라 원문 리그명이 "Primera División - Apertura"
    // "- Clausura" 등으로 계속 바뀌기 때문에, 특정 문자열 매칭 대신 country 필드로 판별한다.
    // (country 검증은 countryOk()에서 한 번 더 확인하지만, 여기서 country로 직접 판별해두면
    // Apertura/Clausura 어느 쪽이든, 표기가 바뀌어도 안정적으로 잡힌다.)
    else if (lg.includes('프리메라디비전') || (country && String(country).toLowerCase() === 'uruguay')) key = 'soccer_uruguay';
    else if (lg.includes('코파 리베르타도레스') || lg === 'CONMEBOL LIBERTADORES') key = 'soccer_libertadores';
    else if (lg.includes('코파 수다메리카나') || lg === 'CONMEBOL SUDAMERICANA') key = 'soccer_sudamericana';
    else if (lg.includes('라리가2') || lg.includes('SEGUNDA DIVISI')) key = 'soccer_laliga2';
    // "네이션스리그(W)"가 "네이션스리그"의 부분집합 문자열이라, 여성부를 먼저 확인해야 함
    else if (lg.includes('네이션스리그(W)') || lg === 'NATIONS LEAGUE WOMEN') key = 'soccer_nations_w';
    else if (lg.includes('네이션스리그') || lg === 'NATIONS LEAGUE') key = 'soccer_nations';
    else if (lg.includes('월드컵 (W)') || lg === 'WORLD CUP - WOMEN') key = 'soccer_wwc';
    else if (lg.includes('AFC 아시안컵') || lg === 'AFC ASIAN CUP') key = 'soccer_afc_asiancup';
    else if (lg.includes('국제친선') || lg === 'FRIENDLIES' || lg === 'FRIENDLY INTERNATIONAL') key = 'soccer_friendly';
    else if (lg === 'D1' || lg === 'JUPILER PRO LEAGUE' || lg === 'PREMIER DIVISION') {
      // "D1"이라는 표기를 벨기에/아일랜드 등 여러 나라가 공유하므로 country로만 최종 판별한다.
      // country가 없거나 등록된 나라가 아니면 오매칭 방지를 위해 안전하게 스킵한다.
      const c = (country || '').toLowerCase();
      if (lg === 'JUPILER PRO LEAGUE' || c === 'belgium') key = 'soccer_belgium';
      else if (c === 'ireland' || c === 'republic of ireland') key = 'soccer_ireland';
    }
    // K1(K리그): 예전엔 팀명 매칭 100% 실패로 제외했었는데, 원인이 ESPN이 스폰서명을
    // 생략한 축약 팀명을 쓰는 것(예: "Ulsan HD")으로 확인되어 TEAM_NAME_ALIASES로 보강 후 재활성화.
    else if (lg.includes('K1') || lg === 'K LEAGUE 1')                key = 'soccer_kleague';

    if (key && countryOk(key, country)) return key;
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────
// 팀명 정규화/매칭
// ─────────────────────────────────────────────

// ESPN이 DB(api-sports 등)와 다르게 표기하는 국가대표팀 별칭.
// key/value 모두 normalize()를 거친 형태(소문자, 특수문자 제거)로 비교하므로
// 원문 그대로 적어두면 됨. 한쪽 표기만 알아도 다른 쪽과 매칭되도록
// 자주 갈리는 케이스를 하나의 표준형으로 모아준다.
const NATION_ALIASES = {
  usa: 'unitedstates',
  unitedstates: 'unitedstates',
  southkorea: 'korearepublic',
  korea: 'korearepublic',
  korearepublic: 'korearepublic',
};

// ─────────────────────────────────────────────
// ESPN이 api-sports와 다른 축약 팀명을 쓰는 경우의 예외 매핑.
// (예: K리그 "Ulsan Hyundai FC"를 ESPN은 "Ulsan HD"로 표기 — 중간에 낀 스폰서명
//  "Hyundai" 때문에 일반 부분포함 매칭이 실패함. 이런 사례가 발견될 때마다 추가한다.)
// 값은 normalizeTeamForMatch를 거친 정규화 문자열 기준.
// ─────────────────────────────────────────────
const TEAM_NAME_ALIASES = {
  'ulsanhd': 'ulsanhyundaifc',
  'usa': 'unitedstates',
  'interdescaldes': 'interclubdescaldes',
  'newyorkredbulls': 'redbullnewyork',
  'charlotte': 'charlottefc',
  'cerro': 'cerroLargo',
  'racingmontevideo': 'racing(montevideo)',
};

function resolveTeamAlias(normalized) {
  return TEAM_NAME_ALIASES[normalized] || normalized;
}

export function normalize(str) {
  // 발음기호(다이어크리틱)가 있는 문자를 그냥 삭제하면 글자 자체가 없어져서
  // 비교가 깨진다(예: "Žalgiris" -> "algiris"). NFD로 분해해서 결합 발음기호만
  // 떼어내면 "Ž" -> "Z"처럼 기본 알파벳으로 안전하게 변환된다.
  // ⚠️ 근데 NFD 분해는 한글도 초성/중성/종성 낱자로 쪼개버린다(예: "플" -> ㅍ+ㅡ+ㄹ).
  // 그 분해된 자모는 아래 필터(a-z0-9가-힣)의 "가-힣"(완성형 한글) 범위 밖이라
  // 전부 삭제되고, 한글 문자열끼리 비교하면 항상 빈 문자열이 되어 "완전히 같은
  // 팀명도 다르다고 오판"하는 심각한 버그가 있었다(실사용 중 발견, 2026-07).
  // 그래서 발음기호 제거 후 NFC로 다시 재조합해서 한글을 완성형으로 되돌린다.
  const stripped = (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  return stripped.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}
export function normalizeTeamForMatch(str) {
  const n = normalize(String(str).replace(/\s+W$/i, ''));
  return NATION_ALIASES[n] || n;
}

// ─────────────────────────────────────────────
// team_name_map.js 기반 동의어 판별.
// team_name_map.js는 원래 "영문 표기 → 한글 표시명" 변환용 파일이지만, 실제로는 같은
// 클럽의 여러 영문 표기가 이미 같은 한글 값으로 묶여 있는 경우가 많다
// (예: "1. FC Heidenheim"/"FC Heidenheim" → 둘 다 "하이덴하임",
//      "Paris Saint Germain"/"Paris Saint-Germain"/"PSG" → 셋 다 "PSG").
// 경기 일정을 이제 fotmob에서 직접 받아오면서(2026-08) fotmob API 엔드포인트마다
// 같은 클럽을 다른 영문 표기로 주는 사고가 늘었는데(예: /matches 목록은 "PSG",
// /matchDetails는 "Paris Saint-Germain"), 이런 짧은 약칭↔정식명 케이스는 문자열
// 유사도(부분 포함) 비교만으로는 절대 안 잡힌다. team_name_map.js에 이미 동의어로
// 등록돼 있는 경우가 많으므로, 이걸 matchTeam()의 1차 판단 기준으로 삼는다.
// ⚠️ 여기서는 normalizeTeamForMatch()가 아니라 W 접미사를 벗기지 않는 순수 normalize()로
// 키를 인덱싱한다. PSG처럼 남녀부가 같은 베이스명("Paris Saint Germain")을 공유하는
// 클럽이 있는데, team_name_map.js엔 이 클럽의 여자팀 전용 키가 따로 없다 — 그 상태에서
// W-스트립된 이름으로 비교하면 "Paris Saint Germain W"(여자팀)가 "Paris Saint Germain"
// (남자팀=PSG)과 같은 팀으로 오인되는 사고가 난다(실사용 확인, 2026-08). 순수 normalize()는
// "W"를 안 벗기므로 이 오인식이 안 생긴다.
const NORMALIZED_KEY_TO_KOREAN = {};
for (const [enKey, koValue] of Object.entries(TEAM_NAME_MAP)) {
  const nk = normalize(enKey);
  if (nk) NORMALIZED_KEY_TO_KOREAN[nk] = koValue;
}

export function matchTeam(espnName, dbName) {
  const en = normalizeTeamForMatch(espnName);
  const dn = normalizeTeamForMatch(dbName);
  if (!en || !dn) return false;
  if (en === dn || en.includes(dn) || dn.includes(en)) return true;

  // team_name_map.js에서 같은 한글 표시명으로 묶이는 동의어인지 확인
  // (짧은 약칭 ↔ 공식 전체명처럼 문자열 유사도로는 안 잡히는 케이스를 커버).
  // W 접미사 유무를 그대로 보존한 순수 normalize()로 비교해서 남녀부 혼동을 막는다.
  const koA = NORMALIZED_KEY_TO_KOREAN[normalize(espnName)];
  const koB = NORMALIZED_KEY_TO_KOREAN[normalize(dbName)];
  if (koA && koB && koA === koB) return true;

  // 일반 매칭 실패 시, 별칭 테이블로 한 번 더 시도 (스폰서명 생략 등 예외 케이스 대응)
  const enAlias = resolveTeamAlias(en);
  const dnAlias = resolveTeamAlias(dn);
  return enAlias === dnAlias || enAlias.includes(dnAlias) || dnAlias.includes(enAlias);
}

// ─────────────────────────────────────────────
// 스코어보드 조회 (날짜 기준 경기 목록)
// ─────────────────────────────────────────────
export async function fetchEspnEvents(espnSport, dateStr) {
  const d = dateStr.replace(/-/g, '');
  const { sport, league } = ESPN_SPORTS[espnSport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${d}&limit=50`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const events = data.events || [];

    if (events.length > 0) {
      const firstDate = (events[0].date || '').slice(0, 10);
      if (firstDate && firstDate !== dateStr) {
        console.log(`   ⚠️ 스코어보드 날짜 불일치(${firstDate} ≠ ${dateStr}), 팀 스케줄로 전환`);
        return [];
      }
    }
    return events;
  } catch (err) {
    console.error(`❌ 스코어보드 호출 실패 (${dateStr}):`, err.message);
    return [];
  }
}

// 팀 스케줄 API로 gameId 검색 (dates 파라미터 미지원 리그용 fallback)
export async function fetchEventFromTeamSchedule(espnSport, teamAbbrOrId, dateStr) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  if (!teamAbbrOrId) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamAbbrOrId}/schedule?season=2026`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const events = data.events || [];

    const target = new Date(dateStr);
    const validDates = new Set([
      new Date(target.getTime() - 86400000).toISOString().slice(0, 10),
      dateStr,
      new Date(target.getTime() + 86400000).toISOString().slice(0, 10),
    ]);
    return events.filter(e => validDates.has((e.date || '').slice(0, 10)));
  } catch (err) {
    console.error(`❌ 팀 스케줄 호출 실패:`, err.message);
    return null;
  }
}

// 경기 매칭 (이벤트 목록 중 home/away 팀명이 일치하는 경기 탐색)
export function findMatchingEvent(events, homeTeamEn, awayTeamEn) {
  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const hn = home.team?.displayName || home.team?.name || '';
    const an = away.team?.displayName || away.team?.name || '';
    if (
      (matchTeam(hn, homeTeamEn) && matchTeam(an, awayTeamEn)) ||
      (matchTeam(hn, awayTeamEn) && matchTeam(an, homeTeamEn))
    ) {
      return { event, home, away, comp };
    }
  }
  return null;
}

// 경기 상세(summary) 조회 — 라인업, injuries 등 포함
export async function fetchSummary(espnSport, gameId) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${gameId}`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`❌ summary 호출 실패 (${gameId}):`, err.message);
    return null;
  }
}

// 리그 순위 조회 (날짜 단위 캐시 권장 — 호출하는 쪽에서 캐싱)
// 주의: 스탠딩 엔드포인트는 site/v2가 아니라 v2 (site 없음) 패턴입니다.
export async function fetchStandings(espnSport) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  const url = `https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`;
  try {
    const res  = await fetch(url);
    if (!res.ok) {
      console.warn(`   ⚠️ standings 응답 실패 (${res.status}): ${espnSport}`);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`❌ standings 호출 실패 (${espnSport}):`, err.message);
    return null;
  }
}

// standings 응답(JSON)에서 팀별 { rank, wins, losses, winPct, gamesBehind } 추출
// ESPN standings 구조는 리그마다 약간씩 달라서 entries를 순회하며 stat name 매칭으로 처리
export function extractTeamStanding(standingsData, teamNameEn) {
  if (!standingsData) return null;

  // children(컨퍼런스/디비전별) 또는 최상위 standings.entries 둘 다 대응
  const groups = standingsData.children?.length
    ? standingsData.children.map(c => c.standings).filter(Boolean)
    : (standingsData.standings ? [standingsData.standings] : []);

  function getStat(entry, name) {
    const found = (entry.stats || []).find(s => (s.name || s.type) === name);
    return found ? found.displayValue : null;
  }
  function sortKey(entry) {
    // 정렬 우선순위: 승률(농구/야구/하키) > 승점(축구) > 승수
    const wp = parseFloat(getStat(entry, 'winPercent'));
    if (!Number.isNaN(wp)) return wp;
    const pts = parseFloat(getStat(entry, 'points'));
    if (!Number.isNaN(pts)) return pts;
    const wins = parseFloat(getStat(entry, 'wins'));
    return Number.isNaN(wins) ? -Infinity : wins;
  }

  for (const group of groups) {
    const entries = group?.entries || [];
    if (entries.length === 0) continue;

    // ⚠️ ESPN의 'rank'/'playoffSeed' 스탯은 디비전 우승팀 우대 등 포스트시즌 규칙이 섞여 있어
    // 순수 전체 순위와 다를 수 있음(검증 완료). 그래서 신뢰하지 않고 승률/승점 기준으로 직접 정렬해서
    // 우리가 직접 순위를 매긴다.
    const sorted = [...entries].sort((a, b) => sortKey(b) - sortKey(a));

    for (let idx = 0; idx < sorted.length; idx++) {
      const entry = sorted[idx];
      const teamName = entry.team?.displayName || entry.team?.name || '';
      if (!matchTeam(teamName, teamNameEn)) continue;

      // 'rank' 스탯이 실제로 존재하면(월드컵 조별리그 등 - 골득실 등 타이브레이커까지 반영된 정확한 값)
      // 그걸 그대로 쓰고, 없는 경우(MLB 등 - 'playoffSeed'는 디비전 우승 우대 규칙이 섞여 있어 신뢰 불가)만
      // 우리가 승률/승점 기준으로 직접 매긴 순위로 폴백한다.
      const nativeRank = getStat(entry, 'rank');
      const rank = nativeRank || String(idx + 1);

      return {
        rank,
        wins: getStat(entry, 'wins'),
        losses: getStat(entry, 'losses'),
        ties: getStat(entry, 'ties'),
        winPercent: getStat(entry, 'winPercent'),
        gamesBehind: getStat(entry, 'gamesBehind'),
        pointsFor: getStat(entry, 'pointsFor') || getStat(entry, 'avgPointsFor'),
        pointsAgainst: getStat(entry, 'pointsAgainst') || getStat(entry, 'avgPointsAgainst'),
      };
    }
  }
  return null;
}

// summary 응답에서 상대전적(H2H) 추출.
// 종목군에 따라 ESPN이 내려주는 형식이 다름:
// - 시즌제 리그(MLB, NBA/WNBA, NHL 추정): summary.seasonseries → 이번 시즌 맞대결 요약 텍스트
// - 국가대항전/컵대회(월드컵 등 soccer 계열): summary.headToHeadGames → 다년간 최근 맞대결 상세 목록
// ⚠️ 팀의 "이번 시즌 전체 스케줄"을 필터링 없이 그대로 반환한다. 이 응답 안에 이미
// 완료된 과거 경기(스코어 포함)와 예정된 경기가 섞여있는데, extractRecentForm()에서
// 완료된 것만 걸러 최근폼으로 쓴다.
// (fetchEventFromTeamSchedule은 "특정 날짜 ±1일 경기 하나 찾기" 용도로 이미 날짜
// 필터링을 하고 있어서, 최근폼처럼 여러 경기가 통째로 필요한 용도엔 못 쓴다 —
// 그래서 별도 함수로 분리함)
export async function fetchTeamSchedule(espnSport, teamId) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  if (!teamId) return [];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.error(`❌ 팀 시즌 스케줄 호출 실패 (teamId=${teamId}):`, err.message);
    return [];
  }
}

// 팀 시즌 스케줄(fetchTeamSchedule 결과)에서 beforeDateStr 이전에 "완료된" 경기만
// 최신순으로 최대 limit개 뽑아서 {date, home, away, homeScore, awayScore} 형태로 반환.
// footystats/masterData의 recentMatches와 동일한 필드 구조라 mergeSoccerMatchSources에
// 그대로 섞어 쓸 수 있다.
export function extractRecentForm(scheduleEvents, beforeDateStr, limit = 10) {
  if (!Array.isArray(scheduleEvents) || scheduleEvents.length === 0) return [];
  const beforeDate = beforeDateStr ? new Date(beforeDateStr) : null;

  const games = scheduleEvents
    .map(e => {
      const comp = e.competitions?.[0];
      const competitors = comp?.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      const isCompleted = comp?.status?.type?.name === 'STATUS_FINAL'
        || comp?.status?.type?.completed === true;
      return {
        date: e.date || '',
        home: home?.team?.displayName || '',
        away: away?.team?.displayName || '',
        homeScore: home?.score?.value != null ? Number(home.score.value) : null,
        awayScore: away?.score?.value != null ? Number(away.score.value) : null,
        isCompleted,
      };
    })
    .filter(g => {
      if (!g.home || !g.away || !g.isCompleted) return false;
      if (g.homeScore === null || g.awayScore === null) return false;
      if (beforeDate) {
        const d = new Date(g.date);
        if (Number.isNaN(d.getTime()) || d >= beforeDate) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
    .map(({ isCompleted, ...g }) => g); // 비교용 필드 제거

  return games;
}

export function extractH2H(summary, beforeDateStr) {
  if (!summary) return null;
  const beforeDate = beforeDateStr ? new Date(beforeDateStr) : null;
  // ⚠️ 날짜만 자르지(slice) 말고 전체 일시(date+time)로 비교해야 한다.
  // 같은 날짜 안에서도 먼저 끝난 경기(예: 오늘 오전 경기)는 정상적으로 H2H에 포함되어야 하고,
  // 분석 대상 경기 자신 또는 그 이후 경기만 제외해야 한다.
  function isStrictlyBefore(rawDateStr) {
    if (!beforeDate) return true; // 기준일 안 넘겨주면 필터링 생략(하위 호환)
    const d = new Date(rawDateStr);
    return !Number.isNaN(d.getTime()) && d < beforeDate;
  }

  // 1) seasonseries 형식 (MLB/NBA/WNBA 등) - 'season'(시즌 전체) 타입의 events를 행 단위로 추출
  if (Array.isArray(summary.seasonseries) && summary.seasonseries.length > 0) {
    const seasonEntry = summary.seasonseries.find(s => s.type === 'season') || summary.seasonseries[0];
    const events = seasonEntry?.events || [];
    if (events.length > 0) {
      const games = events.map(e => {
        const comp = e.competitions?.[0] || e; // 구조 차이 방어
        const competitors = comp.competitors || e.competitors || [];
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        const isCompleted = e.status === 'post' || e.statusType?.completed === true || e.statusType?.state === 'post';
        return {
          rawDate: e.date || '', // 비교용 전체 일시 (필터링 후 제거됨)
          date: e.date || '', // 전체 타임스탬프 유지 (KST 변환은 표시 단계에서 처리 - 날짜만 자르면 타임존 오차 발생)
          home: home?.team?.displayName || '',
          away: away?.team?.displayName || '',
          homeScore: home?.score != null ? Number(home.score) : null,
          awayScore: away?.score != null ? Number(away.score) : null,
          isCompleted,
        };
      })
        .filter(g => g.home && g.away && g.isCompleted && isStrictlyBefore(g.rawDate))
        .map(({ rawDate, ...g }) => g); // 비교용 필드 제거

      if (games.length > 0) {
        return {
          source: 'seasonseries',
          text: seasonEntry.summary || null, // 예: "BAL leads series 3-1" (AI 서술용 보조 텍스트)
          totalGames: games.length,
          games,
        };
      }
    }
  }

  // 2) headToHeadGames 형식 (soccer 계열 - 월드컵, 클럽대항전 등)
  if (Array.isArray(summary.headToHeadGames) && summary.headToHeadGames.length > 0) {
    const group = summary.headToHeadGames[0];
    const events = (group.events || []).slice(0, 10); // ⚠️ 예전엔 5경기까지만 잘랐는데,
    // h2hForAvg(평균 계산용)는 최대 10개까지 쓰므로 원본에 그만큼 있으면 다 활용하도록
    // 확대함(실사용 지적으로 확인, 2026-07). 표시용(h2hHistory)은 여전히 5개로 별도 제한됨.
    if (events.length > 0) {
      const games = events.map(e => {
        const selfIsHome = String(e.homeTeamId) === String(group.team?.id);
        const homeName = selfIsHome ? group.team?.displayName : e.opponent?.displayName;
        const awayName = selfIsHome ? e.opponent?.displayName : group.team?.displayName;
        return {
          rawDate: e.gameDate || '', // 비교용 전체 일시 (필터링 후 제거됨)
          date: e.gameDate || '', // 전체 타임스탬프 유지 (KST 변환은 표시 단계에서 처리)
          home: homeName || '',
          away: awayName || '',
          homeScore: e.homeTeamScore != null ? Number(e.homeTeamScore) : null,
          awayScore: e.awayTeamScore != null ? Number(e.awayTeamScore) : null,
          competition: e.competitionName || e.leagueName || '',
        };
      })
        .filter(g => g.home && g.away && isStrictlyBefore(g.rawDate))
        .map(({ rawDate, ...g }) => g); // 비교용 필드 제거

      if (games.length > 0) {
        return {
          source: 'headToHeadGames',
          totalGames: games.length,
          games,
        };
      }
    }
  }

  return null;
}


// ESPN summary.injuries: [{ team: {...}, injuries: [{ athlete, status, details... }] }]
export function extractInjuries(summary, homeTeamEn, awayTeamEn) {
  const result = { home: [], away: [] };
  const injuryGroups = summary?.injuries;
  if (!Array.isArray(injuryGroups)) return result;

  for (const group of injuryGroups) {
    const teamName = group.team?.displayName || group.team?.name || '';
    const isHome = matchTeam(teamName, homeTeamEn);
    const isAway = matchTeam(teamName, awayTeamEn);
    if (!isHome && !isAway) continue;
    const side = isHome ? 'home' : 'away';

    for (const inj of (group.injuries || [])) {
      const name   = inj.athlete?.displayName || inj.athlete?.shortName || '';
      const status = inj.status || inj.type?.description || '';
      const detail = inj.details?.detail || inj.shortComment || inj.longComment || '';
      if (!name) continue;
      result[side].push({ name, status, detail });
    }
  }
  return result;
}