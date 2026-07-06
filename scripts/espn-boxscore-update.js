import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const POSTS_DIR = path.resolve(__dirname, '../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성
// ─────────────────────────────────────────────
function buildReverseMap(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const reverse = {};
  // 국가대표 남/여 팀이 같은 한글 라벨을 공유하는 경우가 있어서(예: "Belgium"/"Belgium W"
  // 둘 다 "벨기에"), 파일에 어느 쪽이 먼저 나오든 상관없이 "W" 접미사 없는 일반(주로 남자부)
  // 키를 우선 배정한다. 1차: 일반 키 먼저 채우고, 2차: 그래도 비어있는 한글 라벨만
  // "W" 접미사 키(여자부 전용 팀 등)로 보충한다.
  for (const [, en, ko] of pairs) {
    if (/ W$/.test(en)) continue;
    if (!reverse[ko]) reverse[ko] = en;
  }
  for (const [, en, ko] of pairs) {
    if (!/ W$/.test(en)) continue;
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
// 종목별 ESPN API 설정
// ─────────────────────────────────────────────
const ESPN_SPORTS = {
  baseball:        { sport: 'baseball',   league: 'mlb',           label: 'MLB'           },
  basketball:      { sport: 'basketball', league: 'nba',           label: 'NBA'           },
  basketball_summer_utah:       { sport: 'basketball', league: 'nba-summer-utah',       label: 'NBA 썸머리그(솔트레이크)' },
  basketball_summer_lasvegas:   { sport: 'basketball', league: 'nba-summer-las-vegas',  label: 'NBA 썸머리그(라스베가스)' },
  basketball_summer_orlando:    { sport: 'basketball', league: 'nba-summer-orlando',    label: 'NBA 썸머리그(올랜도)' },
  basketball_summer_sacramento: { sport: 'basketball', league: 'nba-summer-sacramento', label: 'NBA 썸머리그(새크라멘토)' },
  wnba:            { sport: 'basketball', league: 'wnba',          label: 'WNBA'          },
  hockey:          { sport: 'hockey',     league: 'nhl',           label: 'NHL'           },
  soccer_mls:      { sport: 'soccer',     league: 'usa.1',         label: 'MLS'           },
  soccer_laliga:   { sport: 'soccer',     league: 'esp.1',         label: '라리가'         },
  soccer_bundesliga:  { sport: 'soccer',  league: 'ger.1',         label: '분데스리가'     },
  soccer_bundesliga2: { sport: 'soccer',  league: 'ger.2',         label: '분데스리가2'    },
  soccer_primeira: { sport: 'soccer',     league: 'por.1',         label: '프리메라리가'   },
  soccer_ucl:      { sport: 'soccer',     league: 'uefa.champions', label: 'UEFA 챔피언스리그' },
  soccer_uel:      { sport: 'soccer',     league: 'uefa.europa',   label: 'UEFA 유로파리그' },
  soccer_worldcup: { sport: 'soccer',     league: 'fifa.world',    label: 'FIFA 월드컵'     },
  soccer_epl:      { sport: 'soccer',     league: 'eng.1',         label: 'P.L'           },
  soccer_seriea:   { sport: 'soccer',     league: 'ita.1',         label: '세리에 A'       },
  soccer_ligue1:   { sport: 'soccer',     league: 'fra.1',         label: '리그1'          },
  soccer_eredivisie: { sport: 'soccer',   league: 'ned.1',         label: '에레디비시'     },
  soccer_kleague:  { sport: 'soccer',     league: 'kor.1',         label: 'K1'            },
  soccer_uruguay:  { sport: 'soccer',     league: 'uru.1',         label: '프리메라디비전' },
  soccer_libertadores: { sport: 'soccer', league: 'conmebol.libertadores', label: '코파 리베르타도레스' },
  soccer_sudamericana: { sport: 'soccer', league: 'conmebol.sudamericana', label: '코파 수다메리카나'   },
  soccer_laliga2:  { sport: 'soccer',     league: 'esp.2',         label: '라리가2'        },
  soccer_uecl:     { sport: 'soccer',     league: 'uefa.europa.conf', label: 'UEFA 컨퍼런스리그' },
  soccer_nations:  { sport: 'soccer',     league: 'uefa.nations',  label: '네이션스리그'    },
  soccer_nations_w:{ sport: 'soccer',     league: 'uefa.w.nations',label: '네이션스리그(W)' },
  soccer_wwc:      { sport: 'soccer',     league: 'fifa.wwc',      label: '월드컵 (W)'     },
  soccer_afc_asiancup: { sport: 'soccer', league: 'afc.asian.cup', label: 'AFC 아시안컵'    },
  soccer_friendly: { sport: 'soccer',     league: 'fifa.friendly', label: '국제친선'        },
  // "D1"이라는 한글 라벨을 여러 나라가 공유해서(벨기에/아일랜드) country로 최종 구분한다.
  soccer_belgium:  { sport: 'soccer',     league: 'bel.1',         label: 'D1(벨기에)'      },
  soccer_ireland:  { sport: 'soccer',     league: 'irl.1',         label: 'D1(아일랜드)'    },
};

function detectEspnSport(category, league, country) {
  const cat = (category || '').toLowerCase();
  const lg  = (league   || '').toUpperCase();
  if (lg.includes('WNBA'))           return 'wnba';
  if (lg.includes('MLB'))            return 'baseball';
  // NBA 썸머리그는 정규시즌(nba)과 ESPN 리그 코드 자체가 달라서 먼저 걸러내야 함
  if (lg.includes('썸머리그') || lg.includes('서머리그') || lg.includes('SUMMER LEAGUE') || lg.includes('CALIFORNIA CLASSIC')) {
    if (lg.includes('솔트레이크') || lg.includes('SALT LAKE') || lg.includes('UTAH'))   return 'basketball_summer_utah';
    if (lg.includes('새크라멘토') || lg.includes('SACRAMENTO') || lg.includes('CALIFORNIA CLASSIC')) return 'basketball_summer_sacramento';
    if (lg.includes('올랜도') || lg.includes('ORLANDO'))       return 'basketball_summer_orlando';
    return 'basketball_summer_lasvegas'; // 도시 특정 안 되면 참가 팀이 가장 많은 라스베가스로 기본 처리
  }
  if (cat === 'basketball' || lg.includes('NBA')) return 'basketball';
  if (cat === 'hockey'   || lg.includes('NHL'))   return 'hockey';
  if (cat === 'soccer') {
    if (lg.includes('MLS'))          return 'soccer_mls';
    if (lg.includes('라리가2'))      return 'soccer_laliga2';
    if (lg.includes('라리가'))       return 'soccer_laliga';
    if (lg.includes('분데스리가2'))  return 'soccer_bundesliga2';
    if (lg.includes('분데스리가') && !lg.includes('분데스리가2')) return 'soccer_bundesliga';
    if (lg.includes('프리메라리가')) return 'soccer_primeira';
    if (lg.includes('UEFA 챔피언스리그') || lg.includes('UEFA CHAMPIONS')) return 'soccer_ucl';
    // 컨퍼런스리그가 "UEFA EUROPA"를 부분 포함하는 원문 표기가 있을 수 있어 유로파리그보다 먼저 확인
    if (lg.includes('UEFA 컨퍼런스리그') || lg.includes('UEFA EUROPA CONFERENCE')) return 'soccer_uecl';
    if (lg.includes('UEFA 유로파리그') || lg.includes('UEFA EUROPA')) return 'soccer_uel';
    if (lg.includes('FIFA 월드컵') || lg.includes('FIFA WORLD') ||
        (lg.includes('월드컵') && !lg.includes('(W)') && !lg.includes('예선'))) return 'soccer_worldcup';
    if (lg.includes('P.L'))          return 'soccer_epl';
    if (lg.includes('세리에 A'))     return 'soccer_seriea';
    if (lg.includes('리그1'))        return 'soccer_ligue1';
    if (lg.includes('에레디비시'))   return 'soccer_eredivisie';
    if (lg.includes('프리메라디비전') || (country && String(country).toLowerCase() === 'uruguay')) return 'soccer_uruguay';
    if (lg.includes('코파 리베르타도레스') || lg === 'CONMEBOL LIBERTADORES') return 'soccer_libertadores';
    if (lg.includes('코파 수다메리카나') || lg === 'CONMEBOL SUDAMERICANA') return 'soccer_sudamericana';
    // "네이션스리그(W)"가 "네이션스리그"의 부분집합 문자열이라 여성부를 먼저 확인
    if (lg.includes('네이션스리그(W)') || lg === 'NATIONS LEAGUE WOMEN') return 'soccer_nations_w';
    if (lg.includes('네이션스리그') || lg === 'NATIONS LEAGUE') return 'soccer_nations';
    if (lg.includes('월드컵 (W)') || lg === 'WORLD CUP - WOMEN') return 'soccer_wwc';
    if (lg.includes('AFC 아시안컵') || lg === 'AFC ASIAN CUP') return 'soccer_afc_asiancup';
    if (lg.includes('국제친선') || lg === 'FRIENDLIES' || lg === 'FRIENDLY INTERNATIONAL') return 'soccer_friendly';
    if (lg === 'D1' || lg === 'JUPILER PRO LEAGUE' || lg === 'PREMIER DIVISION') {
      // "D1" 라벨은 벨기에/아일랜드 등 여러 나라가 공유하므로 country로 최종 판별한다.
      // country가 없거나 등록되지 않은 나라면 오매칭 방지를 위해 안전하게 스킵(undefined 반환)한다.
      const c = (country || '').toLowerCase();
      if (lg === 'JUPILER PRO LEAGUE' || c === 'belgium') return 'soccer_belgium';
      if (c === 'ireland' || c === 'republic of ireland') return 'soccer_ireland';
    }
    // K1(K리그): 예전엔 팀명 매칭 100% 실패로 제외했었는데, 원인이 ESPN이 스폰서명을
    // 생략한 축약 팀명을 쓰는 것(예: "Ulsan HD")으로 확인되어 TEAM_NAME_ALIASES로 보강 후 재활성화.
    if (lg.includes('K1'))           return 'soccer_kleague';
  }
  return null;
}

// ─────────────────────────────────────────────
// 팀명 정규화
// ─────────────────────────────────────────────
// ESPN이 api-sports와 다른 축약 팀명을 쓰는 경우의 예외 매핑.
// (예: K리그 "Ulsan Hyundai FC"를 ESPN은 "Ulsan HD"로 표기 — 중간에 낀 스폰서명
//  "Hyundai" 때문에 일반 부분포함 매칭이 실패함. 이런 사례가 발견될 때마다 추가한다.)
const TEAM_NAME_ALIASES = {
  'ulsanhd': 'ulsanhyundaifc',
};

function resolveTeamAlias(normalized) {
  return TEAM_NAME_ALIASES[normalized] || normalized;
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function normalizeTeamForMatch(str) {
  return normalize(str.replace(/\s+W$/i, ''));
}
function matchTeam(espnName, dbName) {
  const en = normalizeTeamForMatch(espnName);
  const dn = normalizeTeamForMatch(dbName);
  if (!en || !dn) return false;
  if (en === dn || en.includes(dn) || dn.includes(en)) return true;
  // 일반 매칭 실패 시, 별칭 테이블로 한 번 더 시도 (스폰서명 생략 등 예외 케이스 대응)
  const enAlias = resolveTeamAlias(en);
  const dnAlias = resolveTeamAlias(dn);
  return enAlias === dnAlias || enAlias.includes(dnAlias) || dnAlias.includes(enAlias);
}

// ─────────────────────────────────────────────
// ESPN 스코어보드 조회
// ─────────────────────────────────────────────
async function fetchEspnEvents(espnSport, dateStr) {
  const d = dateStr.replace(/-/g, '');
  const { sport, league } = ESPN_SPORTS[espnSport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${d}&limit=50`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const events = data.events || [];

    // dates 파라미터가 무시되는 경우 감지 (WNBA 등)
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

// ─────────────────────────────────────────────
// 팀 스케줄 API로 gameId 검색 (WNBA dates 미지원 fallback)
// ─────────────────────────────────────────────
const WNBA_ABBR_MAP = {
  'atlanta dream': 'atl', 'chicago sky': 'chi', 'connecticut sun': 'con',
  'dallas wings': 'dal', 'golden state valkyries': 'gs', 'indiana fever': 'ind',
  'las vegas aces': 'lv', 'los angeles sparks': 'la', 'minnesota lynx': 'min',
  'new york liberty': 'ny', 'phoenix mercury': 'phx', 'portland fire': 'por',
  'seattle storm': 'sea', 'toronto tempo': 'tor', 'washington mystics': 'wsh',
};

async function fetchEventFromTeamSchedule(espnSport, teamNameEn, dateStr) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  const key  = teamNameEn.toLowerCase().replace(/\s+w$/i, '').trim();
  const abbr = WNBA_ABBR_MAP[key];
  if (!abbr) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${abbr}/schedule?season=2026`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const events = data.events || [];

    // ±1일 범위 매칭 (UTC/KST 차이 고려)
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

// ─────────────────────────────────────────────
// 경기 매칭
// ─────────────────────────────────────────────
function findMatchingEvent(events, homeTeamEn, awayTeamEn) {
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

// ─────────────────────────────────────────────
// summary 조회
// ─────────────────────────────────────────────
async function fetchSummary(espnSport, gameId) {
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

// ─────────────────────────────────────────────
// 야구 예상 라인업 파싱 (rosters + probables)
// ─────────────────────────────────────────────
function parseBaseballRosters(summary, event, homeTeamEn, awayTeamEn) {
  const rosters = summary?.rosters;
  if (!rosters || rosters.length === 0) return null;

  const result = { home: [], away: [] };

  // 선발 타자: starter=true, batOrder 있고 포지션 P 아닌 선수
  for (const rosterGroup of rosters) {
    const teamName = rosterGroup.team?.displayName || rosterGroup.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    const starters = (rosterGroup.roster || [])
      .filter(p => p.starter && p.batOrder && p.position?.abbreviation !== 'P')
      .sort((a, b) => a.batOrder - b.batOrder);

    for (const p of starters) {
      const name  = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos   = p.position?.abbreviation || '';
      const id    = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png` : '';
      const sm    = {};
      (p.stats || []).forEach(s => { sm[s.name] = s.displayValue; });
      const avg = sm['avg'] || '.000';
      let line = `${p.batOrder}번 ${name} (${pos})`;
      if (photo) line += `|${photo}`;
      result[side].push(line);
    }
  }

  // 선발 투수: event의 probables에서 추출 → 맨 앞에 삽입
  const comp = event?.competitions?.[0];
  for (const competitor of (comp?.competitors || [])) {
    const teamName = competitor.team?.displayName || competitor.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    for (const prob of (competitor.probables || [])) {
      const name    = prob.athlete?.shortName || '';
      const record  = prob.record || '';
      const eraStat = (prob.statistics || []).find(s => s.abbreviation === 'ERA');
      const era     = eraStat?.displayValue || '';
      const probId  = prob.athlete?.id || '';
      const photo   = probId ? `https://a.espncdn.com/i/headshots/mlb/players/full/${probId}.png` : '';
      if (name) {
        // record에 이미 괄호 포함된 경우 그대로, 없으면 괄호 추가
        let line = `선발투수 ${name}`;
        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era)    line += ` ERA ${era}`;
        if (photo)  line += `|${photo}`;
        result[side].unshift(line);
      }
    }
  }

  if (result.home.length === 0 && result.away.length === 0) return null;
  return result;
}

// ─────────────────────────────────────────────
// 축구 라인업 파싱 (rosters)
// ─────────────────────────────────────────────
function parseSoccerRosters(summary, homeTeamEn, awayTeamEn) {
  const rosters = summary?.rosters;
  if (!rosters || rosters.length === 0) return null;

  const result = { home: [], away: [], homeFormation: '', awayFormation: '' };

  for (const rosterGroup of rosters) {
    const teamName = rosterGroup.team?.displayName || rosterGroup.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    if (rosterGroup.formation) {
      if (isHome) result.homeFormation = rosterGroup.formation;
      else        result.awayFormation = rosterGroup.formation;
    }

    const starters = (rosterGroup.roster || [])
      .filter(p => p.starter)
      .sort((a, b) => (a.jerseyNumber || 0) - (b.jerseyNumber || 0));

    for (const p of starters) {
      const name  = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos   = p.position?.abbreviation || '';
      const id    = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png` : '';
      if (name) result[side].push(`${name} (${pos})${photo ? '|' + photo : ''}`);
    }
  }

  if (result.home.length === 0 && result.away.length === 0) return null;
  return result;
}

// ─────────────────────────────────────────────
// 농구/WNBA 라인업 파싱 (rosters)
// ─────────────────────────────────────────────
function parseBasketballRosters(summary, homeTeamEn, awayTeamEn) {
  const rosters = summary?.rosters;
  if (!rosters || rosters.length === 0) return null;

  const result = { home: [], away: [] };

  for (const rosterGroup of rosters) {
    const teamName = rosterGroup.team?.displayName || rosterGroup.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    const starters = (rosterGroup.roster || []).filter(p => p.starter);

    for (const p of starters) {
      const name  = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos   = p.position?.abbreviation || '';
      const id    = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : '';
      const sm    = {};
      (p.stats || []).forEach(s => { sm[s.name] = s.displayValue; });
      const ppg = sm['avgPoints'] || sm['points'] || '';
      let line = `${name} (${pos})`;
      if (ppg) line += ` | 평균 ${ppg}점`;
      if (photo) line += `|${photo}`;
      result[side].push(line);
    }
  }

  if (result.home.length === 0 && result.away.length === 0) return null;
  return result;
}

// ─────────────────────────────────────────────
// 농구: 경기 종료 후 대비 - boxscore.players(실제 출전/선발 여부 포함)에서 선발 추출
// (rosters는 경기 전 예상 명단이라 경기 끝나면 비어있는 경우가 있음 - 그때 이걸로 대체)
// ─────────────────────────────────────────────
function parseBasketballBoxscoreStarters(summary, homeTeamEn, awayTeamEn) {
  const players = summary?.boxscore?.players;
  if (!players || players.length === 0) return null;

  const result = { home: [], away: [] };

  for (const teamBlock of players) {
    const teamName = teamBlock.team?.displayName || teamBlock.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    const athleteEntries = teamBlock.statistics?.[0]?.athletes || [];
    const starters = athleteEntries.filter(p => p.starter);

    for (const p of starters) {
      const name  = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos   = p.athlete?.position?.abbreviation || '';
      const id    = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : '';
      let line = `${name} (${pos})`;
      if (photo) line += `|${photo}`;
      result[side].push(line);
    }
  }

  if (result.home.length === 0 && result.away.length === 0) return null;
  return result;
}

// ─────────────────────────────────────────────
// Fallback: 스코어보드 leaders
// ─────────────────────────────────────────────
function parseLeadersFromEvent(event, homeTeamEn, awayTeamEn) {
  const comp   = event.competitions?.[0];
  const result = { home: [], away: [] };
  if (!comp) return result;

  for (const competitor of (comp.competitors || [])) {
    const teamName = competitor.team?.displayName || competitor.team?.name || '';
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    for (const prob of (competitor.probables || [])) {
      const name   = prob.athlete?.shortName || '';
      const record = prob.record || '';
      const eraStat = (prob.statistics || []).find(s => s.abbreviation === 'ERA');
      const era     = eraStat?.displayValue || '';
      const probId  = prob.athlete?.id || '';
      const photo   = probId ? `https://a.espncdn.com/i/headshots/mlb/players/full/${probId}.png` : '';
      if (name) {
        let line = `선발투수 ${name}`;
        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era)    line += ` ERA ${era}`;
        if (photo)  line += `|${photo}`;
        result[side].push(line);
      }
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// md frontmatter 업데이트
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

// ─────────────────────────────────────────────
// frontmatter 파싱
// ─────────────────────────────────────────────
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

function getDateFromFilename(filePath) {
  const m = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// 파일명 "2026-07-07-501866-memphis-grizzlies.md"에서 경기 ID(501866)를 뽑아낸다.
// 팀명+날짜로 애매하게 찾는 것보다 ID로 정확히 찾는 게 훨씬 안전하다.
function getMatchIdFromFilename(filePath) {
  const m = path.basename(filePath).match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);
  return m ? m[1] : null;
}

// ⚠️ 글 파일명 날짜는 "경기 날짜"가 아니라 "글이 생성된 날"(그날 읽은 database/{그날}.json)이다.
// fetch-all.js가 D+2까지 미리 일정을 당겨와 분석글을 만들어두기 때문에, 실제 경기는 파일명
// 날짜보다 최대 2일 뒤에 열릴 수 있다 (예: 07-04에 생성된 글 안에 07-06 경기가 들어있는 경우).
// 그래서 이 스크립트가 "오늘" 실행돼도, 오늘 경기의 라인업을 채워야 할 글은 파일명이
// 최대 2일 전 날짜일 수 있다 — ±1일로는 부족하고 ±2일 범위까지 봐야 한다.
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
// 메인
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 썸머리그 도시 대조용: database/{date}.json 원본 fixtures 캐시
// (analyze-router-one-git.js가 표시용으로는 "NBA 썸머리그"로 뭉개버려서,
//  라인업 매칭에 필요한 도시 정보는 원본 파일을 다시 대조해서 알아낸다)
// ─────────────────────────────────────────────
const rawFixturesCache = {};

function loadRawFixtures(dateStr) {
  if (dateStr in rawFixturesCache) return rawFixturesCache[dateStr];
  const p = path.resolve(__dirname, `../database/${dateStr}.json`);
  if (!fs.existsSync(p)) { rawFixturesCache[dateStr] = null; return null; }
  try {
    rawFixturesCache[dateStr] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    rawFixturesCache[dateStr] = null;
  }
  return rawFixturesCache[dateStr];
}

// ─────────────────────────────────────────────
// database/{date}.json은 cleanup-database.js가 오래된 스냅샷을 정리하기 때문에,
// 이 스크립트가 늦게 실행되면 정작 필요한 날짜의 스냅샷이 이미 사라져 있을 수 있다.
// 반면 database/all-fixtures.json은 절대 삭제되지 않는 누적 DB라서, 최후의 폴백으로 쓴다.
// ─────────────────────────────────────────────
let allFixturesCache = undefined; // undefined=아직 안 불러옴, null=파일 없음/실패, 배열=로드됨

function loadAllFixtures() {
  if (allFixturesCache !== undefined) return allFixturesCache;
  const p = path.resolve(__dirname, '../database/all-fixtures.json');
  if (!fs.existsSync(p)) { allFixturesCache = null; return null; }
  try {
    allFixturesCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    allFixturesCache = null;
  }
  return allFixturesCache;
}

// 홈/원정 영문 팀명 + 날짜(+가능하면 경기 ID)로 원본(도시 정보 포함) 리그명 찾기. 못 찾으면 null.
// 수집기(analyze-router-one-git.js)는 미국 현지 경기일 기준으로 database/{date}.json을 묶어 저장하는 반면,
// 이 스크립트는 글 파일명의 KST 날짜를 기준으로 조회하기 때문에 두 날짜가 어긋날 수 있다.
// 게다가 fetch-all.js가 D+2까지 미리 일정을 당겨와 분석글을 만들어두기 때문에, "오늘 날짜 파일"
// 하나만 봐서는 안 되고 실제로는 그 경기가 며칠 전(D-1) ~ 며칠 후(D+2) 파일 중 어디에 들어있을지
// 알 수 없다. 그래서 D-1부터 D+2까지 폭넓게 뒤진다.
// matchId가 있으면 팀명/날짜 매칭보다 우선해서 ID로 정확히 대조한다(가장 안전).
function findRawLeagueName(dateStr, homeTeamEn, awayTeamEn, matchId = null) {
  const base = new Date(`${dateStr}T00:00:00Z`).getTime();
  const dayOffsets = [-1, 0, 1, 2]; // D-1 ~ D+2
  const candidateDates = dayOffsets.map(n =>
    new Date(base + n * 86400000).toISOString().slice(0, 10)
  );

  const byId = (fixtures) => matchId ? fixtures.find(m => String(m.id) === String(matchId)) : null;
  const byTeams = (fixtures) => fixtures.find(m =>
    (normalizeTeamForMatch(m.home) === normalizeTeamForMatch(homeTeamEn) && normalizeTeamForMatch(m.away) === normalizeTeamForMatch(awayTeamEn)) ||
    (normalizeTeamForMatch(m.home) === normalizeTeamForMatch(awayTeamEn) && normalizeTeamForMatch(m.away) === normalizeTeamForMatch(homeTeamEn))
  );

  for (const d of candidateDates) {
    const fixtures = loadRawFixtures(d);
    if (!fixtures) continue;
    const found = byId(fixtures) || byTeams(fixtures);
    if (found) return found.league || null;
  }

  // 날짜 범위 안의 스냅샷 파일들이 전부 없거나(cleanup으로 삭제됨) 못 찾았으면,
  // 절대 삭제되지 않는 누적 DB(all-fixtures.json)에서 마지막으로 시도.
  // 누적 DB는 데이터가 많아 팀명만으로 찾으면 다른 날짜 경기와 헷갈릴 수 있으므로
  // ID가 있을 때만(가장 정확할 때만) 사용한다.
  if (matchId) {
    const all = loadAllFixtures();
    if (all) {
      const found = byId(all);
      if (found) return found.league || null;
    }
  }

  return null;
}

async function main() {
  console.log('📊 ESPN 라인업 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  const eventCache = {};
  let updatedCount = 0;
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    // 라인업이 이미 채워져 있으면 스킵. 종목별로 저장 포맷이 달라서 체크 방식을 분기한다.
    // - 야구: "1번 김민석 (좌익수)" 형태라 '번 ' 포함 여부로 판단.
    //   단, 선발투수 사진 기능을 나중에 추가했기 때문에 '번 '만 보면 사진 없는 기존 글이
    //   영원히 재처리 안 됨 → 선발투수 줄에 사진(|)까지 있는지도 같이 확인.
    // - 그 외(축구/농구 등): "손흥민 (FW)|photo" 형태라 '번 '이 절대 없음 → 내용이 비어있는지("" 또는 "[]")로 판단
    //
    // ⚠️ 홈/원정 라인업은 ESPN에서 각 팀이 개별적으로, 그것도 서로 다른 시점에 발표한다.
    // 한쪽만(예: homeLineup) 보고 완료 판정을 하면, 먼저 발표된 쪽만 채워진 상태에서
    // 파일 전체가 "완료"로 스킵되어 늦게 발표되는 반대쪽 팀 라인업이 영영 채워지지 않는
    // 비대칭 버그가 생긴다. 따라서 홈/원정을 각각 판단해서 "둘 다" 완료된 경우에만 스킵한다.
    const category  = fm.category  || '';

    const isLineupComplete = (rawLineup) => {
      const unescaped = (rawLineup || '').replace(/\\"/g, '"').trim();
      const hasBatters = category === 'baseball'
        ? unescaped.includes('번 ')
        : (unescaped !== '' && unescaped !== '[]');
      const pitcherMatch = unescaped.match(/선발투수[^"]*/);
      const hasPitcherPhoto = category === 'baseball'
        ? !!(pitcherMatch && pitcherMatch[0].includes('|'))
        : true; // 야구 아니면 이 조건 자체가 무관하므로 항상 통과
      return hasBatters && hasPitcherPhoto;
    };

    if (isLineupComplete(fm.homeLineup) && isLineupComplete(fm.awayLineup)) {
      console.log(`⏩ [스킵] 라인업 완료: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    const league    = fm.league    || '';
    const homeTeamKo = fm.homeTeam || '';
    const awayTeamKo = fm.awayTeam || '';
    const dateStr   = getDateFromFilename(filePath);

    if (!dateStr) {
      console.log(`⚠️ [스킵] 날짜 추출 실패: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(homeTeamKo);
    const awayTeamEn = toEnglishTeamName(awayTeamKo);
    const matchId    = getMatchIdFromFilename(filePath);

    // 표시용 리그명이 "NBA 썸머리그"로 뭉개져서 도시 구분이 안 될 때만,
    // 원본 raw fixtures 파일을 다시 대조해서 실제 도시가 들어간 리그명으로 재감지
    let detectLeague = league;
    if (league.includes('썸머리그') || league.includes('서머리그') || league === 'California Classic') {
      const rawLeague = findRawLeagueName(dateStr, homeTeamEn, awayTeamEn, matchId);
      if (rawLeague) {
        detectLeague = rawLeague;
        console.log(`   ℹ️ 썸머리그 도시 대조: 표시="${league}" → 원본="${rawLeague}"`);
      } else {
        console.log(`   ⚠️ 썸머리그 원본 대조 실패 - database/${dateStr}.json 전후(D-1~D+2) 및 누적 DB에서 못 찾음 (라스베가스로 기본 처리)`);
      }
    }
    const espnSport  = detectEspnSport(category, detectLeague, fm.country);

    if (!espnSport || espnSport === 'wnba') {
  skipCount++;
  continue;
}

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${homeTeamKo} → ${homeTeamEn}`);
    console.log(`   원정: ${awayTeamKo} → ${awayTeamEn}`);
    console.log(`   날짜(KST): ${dateStr} / 종목: ${ESPN_SPORTS[espnSport].label}`);

    // 스코어보드 조회 (캐시)
    // ⚠️ 예전엔 파일명 날짜(dateStr)를 "KST 자정"으로 가정하고 UTC로 역산했는데,
    //    실제로는 파일명이 database/{date}.json의 미국 현지 기준 날짜를 그대로
    //    물려받은 것이라 이 가정이 틀렸다 (예: 파일명 "2026-07-06"인데 실제 경기는
    //    UTC 기준 07-07인 경우가 흔함 — 특히 미국 저녁 경기가 자정을 넘길 때).
    //    frontmatter의 date 필드는 실제 경기 시각을 정확한 오프셋과 함께 그대로
    //    저장해두고 있으므로, 이걸 직접 UTC로 변환해서 쓰는 게 훨씬 정확하다.
    let utcDateStr;
    if (fm.date && !isNaN(new Date(fm.date))) {
      utcDateStr = new Date(fm.date).toISOString().slice(0, 10);
    } else {
      console.log(`   ⚠️ frontmatter date 파싱 실패 — 파일명 기반 추정치로 폴백`);
      utcDateStr = new Date(`${dateStr}T00:00:00+09:00`).toISOString().slice(0, 10);
    }
const cacheKey = `${espnSport}_${utcDateStr}`;
if (!eventCache[cacheKey]) {
  console.log(`   📡 스코어보드 호출: ${utcDateStr}`);
  eventCache[cacheKey] = await fetchEspnEvents(espnSport, utcDateStr);
  await new Promise(r => setTimeout(r, 800));
}

    let matched = findMatchingEvent(eventCache[cacheKey], homeTeamEn, awayTeamEn);

    // 매칭 실패 시 팀 스케줄로 재시도
    if (!matched) {
      console.log(`   🔄 팀 스케줄 API로 재시도...`);
      const scheduleEvents =
        await fetchEventFromTeamSchedule(espnSport, homeTeamEn, dateStr) ||
        await fetchEventFromTeamSchedule(espnSport, awayTeamEn, dateStr);
      if (scheduleEvents?.length > 0) {
        matched = findMatchingEvent(scheduleEvents, homeTeamEn, awayTeamEn);
      }
    }

    if (!matched) {
      console.log(`   ⚠️ 경기 매칭 실패`);
      // K리그는 예전에 팀명 표기 차이(스폰서명 생략 등)로 매칭이 자주 실패했던 전례가 있어서,
      // 실패 시 ESPN이 그날 실제로 어떤 팀명을 쓰는지 로그에 남겨 TEAM_NAME_ALIASES 보강에 활용한다.
      if (espnSport === 'soccer_kleague') {
        const todaysEspnTeams = (eventCache[cacheKey] || []).flatMap(e => {
          const comp = e.competitions?.[0];
          return (comp?.competitors || []).map(c => c.team?.displayName || c.team?.name || '');
        });
        console.log(`   [진단] 우리 팀명: "${homeTeamEn}" / "${awayTeamEn}"`);
        console.log(`   [진단] ESPN이 그날 쓴 팀명 목록: ${JSON.stringify([...new Set(todaysEspnTeams)])}`);
      }
      skipCount++;
      continue;
    }

    const { event, comp } = matched;
    const gameId = event.id;
    const status = comp.status?.type?.state || '';
    console.log(`   ✅ 매칭 성공 gameId: ${gameId} (상태: ${status})`);

    // summary 조회
    const summary = await fetchSummary(espnSport, gameId);
    await new Promise(r => setTimeout(r, 1200));

    let homeLineup = [];
    let awayLineup = [];
    const updates  = {};

    if (espnSport === 'baseball') {
      const parsed = summary ? parseBaseballRosters(summary, event, homeTeamEn, awayTeamEn) : null;
      if (parsed) {
        homeLineup = parsed.home;
        awayLineup = parsed.away;
      } else {
        const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);
        homeLineup = leaders.home;
        awayLineup = leaders.away;
      }
    } else if (espnSport === 'basketball' || espnSport.startsWith('basketball_summer') || espnSport === 'wnba') {
      let parsed = summary ? parseBasketballRosters(summary, homeTeamEn, awayTeamEn) : null;
      if (!parsed) parsed = summary ? parseBasketballBoxscoreStarters(summary, homeTeamEn, awayTeamEn) : null;
      if (parsed) {
        homeLineup = parsed.home;
        awayLineup = parsed.away;
      } else {
        const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);
        homeLineup = leaders.home;
        awayLineup = leaders.away;
      }
    } else if (espnSport.startsWith('soccer_')) {
      const parsed = summary ? parseSoccerRosters(summary, homeTeamEn, awayTeamEn) : null;
      if (parsed) {
        homeLineup = parsed.home;
        awayLineup = parsed.away;
        if (parsed.homeFormation) updates.homeFormation = parsed.homeFormation;
        if (parsed.awayFormation) updates.awayFormation = parsed.awayFormation;
      } else {
        console.log(`   ℹ️ ${ESPN_SPORTS[espnSport].label} ESPN 라인업 정보 미지원`);
        const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);
        homeLineup = leaders.home;
        awayLineup = leaders.away;
      }
    } else {
      const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);
      homeLineup = leaders.home;
      awayLineup = leaders.away;
    }

    if (homeLineup.length === 0 && awayLineup.length === 0) {
      console.log(`   ⚠️ 라인업 데이터 없음`);
      if ((espnSport === 'basketball' || espnSport.startsWith('basketball_summer') || espnSport === 'wnba') && summary) {
        const players = summary?.boxscore?.players;
        console.log(`   [진단] boxscore.players 존재: ${!!players} / 길이: ${players?.length ?? 'N/A'}`);
        if (players && players.length > 0) {
          const firstTeamAthletes = players[0]?.statistics?.[0]?.athletes;
          console.log(`   [진단] 첫 팀 athletes 길이: ${firstTeamAthletes?.length ?? 'N/A'} / starter 필드 존재 예시: ${JSON.stringify(firstTeamAthletes?.[0]?.starter)}`);
        }
        console.log(`   [진단] summary?.rosters 존재: ${!!summary?.rosters} / 길이: ${summary?.rosters?.length ?? 'N/A'}`);
      }
      skipCount++;
      continue;
    }

    // 재처리 시, 이미 완성되어 있던 쪽을 이번 응답이 비어있다는 이유로 덮어써서
    // 되돌리는 일이 없도록 방어한다 (예: 홈은 이미 발표됐는데 원정만 늦게 나오는 경우,
    // 원정을 채우려고 재처리하다가 홈 쪽 응답이 일시적으로 비어 온다고 해서 홈을 지우면 안 됨).
    const newHomeLineupStr = JSON.stringify(homeLineup);
    const newAwayLineupStr = JSON.stringify(awayLineup);

    if (isLineupComplete(fm.homeLineup) && !isLineupComplete(newHomeLineupStr)) {
      console.log(`   ℹ️ 홈 라인업은 기존 값 유지 (신규 응답이 비어있음)`);
    } else {
      updates.homeLineup = newHomeLineupStr;
    }

    if (isLineupComplete(fm.awayLineup) && !isLineupComplete(newAwayLineupStr)) {
      console.log(`   ℹ️ 원정 라인업은 기존 값 유지 (신규 응답이 비어있음)`);
    } else {
      updates.awayLineup = newAwayLineupStr;
    }

    const ok = updateMdFrontmatter(filePath, updates);

    if (ok) {
      const loggedHomeCount = updates.homeLineup ? JSON.parse(updates.homeLineup).length : '기존유지';
      const loggedAwayCount = updates.awayLineup ? JSON.parse(updates.awayLineup).length : '기존유지';
      console.log(`   🔄 업데이트 완료 | 홈 ${loggedHomeCount}건 / 원정 ${loggedAwayCount}건`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();