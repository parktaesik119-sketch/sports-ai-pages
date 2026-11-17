
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveFormationFromLineup } from './formation-common.js';

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
  soccer_ucl_qual: { sport: 'soccer',     league: 'uefa.champions_qual', label: 'UEFA 챔피언스리그 예선' },
  soccer_uel:      { sport: 'soccer',     league: 'uefa.europa',   label: 'UEFA 유로파리그' },
  soccer_uel_qual: { sport: 'soccer',     league: 'uefa.europa_qual', label: 'UEFA 유로파리그 예선' },
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
  soccer_uecl_qual:{ sport: 'soccer',     league: 'uefa.europa.conf_qual', label: 'UEFA 컨퍼런스리그 예선' },
  soccer_nations:  { sport: 'soccer',     league: 'uefa.nations',  label: '네이션스리그'    },
  soccer_nations_w:{ sport: 'soccer',     league: 'uefa.w.nations',label: '네이션스리그(W)' },
  soccer_wwc:      { sport: 'soccer',     league: 'fifa.wwc',      label: '월드컵 (W)'     },
  soccer_afc_asiancup: { sport: 'soccer', league: 'afc.asian.cup', label: 'AFC 아시안컵'    },
  soccer_friendly: { sport: 'soccer',     league: 'fifa.friendly', label: '국제친선'        },
  soccer_belgium:  { sport: 'soccer',     league: 'bel.1',         label: 'D1(벨기에)'      },
  soccer_ireland:  { sport: 'soccer',     league: 'irl.1',         label: 'D1(아일랜드)'    },
};

function detectEspnSport(category, league, country, matchDate) {
  const cat = (category || '').toLowerCase();
  const lg  = (league   || '').toUpperCase();

  const isUefaQualSeason = (() => {
    if (!matchDate) return false;
    const m = new Date(matchDate).getUTCMonth() + 1;
    return m >= 6 && m <= 8;
  })();

  if (lg.includes('WNBA'))           return 'wnba';
  if (lg.includes('MLB'))            return 'baseball';

  if (lg.includes('썸머리그') || lg.includes('서머리그') || lg.includes('SUMMER LEAGUE') || lg.includes('CALIFORNIA CLASSIC')) {
    if (lg.includes('솔트레이크') || lg.includes('SALT LAKE') || lg.includes('UTAH'))   return 'basketball_summer_utah';
    if (lg.includes('새크라멘토') || lg.includes('SACRAMENTO') || lg.includes('CALIFORNIA CLASSIC')) return 'basketball_summer_sacramento';
    if (lg.includes('올랜도') || lg.includes('ORLANDO'))       return 'basketball_summer_orlando';
    return 'basketball_summer_lasvegas';
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

    if (lg.includes('UEFA 챔피언스리그') || lg.includes('UEFA CHAMPIONS')) {
      return isUefaQualSeason ? 'soccer_ucl_qual' : 'soccer_ucl';
    }

    if (lg.includes('UEFA 컨퍼런스리그') || lg.includes('UEFA EUROPA CONFERENCE')) {
      return isUefaQualSeason ? 'soccer_uecl_qual' : 'soccer_uecl';
    }

    if (lg.includes('UEFA 유로파리그') || lg.includes('UEFA EUROPA')) {
      return isUefaQualSeason ? 'soccer_uel_qual' : 'soccer_uel';
    }

    if (lg.includes('FIFA 월드컵') || lg.includes('FIFA WORLD') ||
        (lg.includes('월드컵') && !lg.includes('(W)') && !lg.includes('예선'))) return 'soccer_worldcup';

    if (lg.includes('P.L'))          return 'soccer_epl';
    if (lg.includes('세리에 A'))     return 'soccer_seriea';
    if (lg.includes('리그1'))        return 'soccer_ligue1';
    if (lg.includes('에레디비시'))   return 'soccer_eredivisie';

    if (lg.includes('프리메라디비전') || (country && String(country).toLowerCase() === 'uruguay')) return 'soccer_uruguay';

    if (lg.includes('코파 리베르타도레스') || lg === 'CONMEBOL LIBERTADORES') return 'soccer_libertadores';
    if (lg.includes('코파 수다메리카나') || lg === 'CONMEBOL SUDAMERICANA') return 'soccer_sudamericana';

    if (lg.includes('네이션스리그(W)') || lg === 'NATIONS LEAGUE WOMEN') return 'soccer_nations_w';
    if (lg.includes('네이션스리그') || lg === 'NATIONS LEAGUE') return 'soccer_nations';

    if (lg.includes('월드컵 (W)') || lg === 'WORLD CUP - WOMEN') return 'soccer_wwc';
    if (lg.includes('AFC 아시안컵') || lg === 'AFC ASIAN CUP') return 'soccer_afc_asiancup';
    if (lg.includes('국제친선') || lg === 'FRIENDLIES' || lg === 'FRIENDLY INTERNATIONAL') return 'soccer_friendly';

    if (lg === 'D1' || lg === 'JUPILER PRO LEAGUE' || lg === 'PREMIER DIVISION') {
      const c = (country || '').toLowerCase();
      if (lg === 'JUPILER PRO LEAGUE' || c === 'belgium') return 'soccer_belgium';
      if (c === 'ireland' || c === 'republic of ireland') return 'soccer_ireland';
    }

    if (lg.includes('K1')) return 'soccer_kleague';
  }

  return null;
}

// ─────────────────────────────────────────────
// 팀명 정규화
// ─────────────────────────────────────────────
const TEAM_NAME_ALIASES = {
  'ulsanhd': 'ulsanhyundaifc',
  'usa': 'unitedstates',
  'interdescaldes': 'interclubdescaldes',
  'newyorkredbulls': 'redbullnewyork',
  'charlotte': 'charlottefc',
};

function resolveTeamAlias(normalized) {
  return TEAM_NAME_ALIASES[normalized] || normalized;
}

function normalize(str) {
  const stripped = (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  return stripped.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function normalizeTeamForMatch(str) {
  return normalize(str.replace(/\s+W$/i, ''));
}

function matchTeam(espnName, dbName) {
  const en = normalizeTeamForMatch(espnName);
  const dn = normalizeTeamForMatch(dbName);

  if (!en || !dn) return false;
  if (en === dn || en.includes(dn) || dn.includes(en)) return true;

  const enAlias = resolveTeamAlias(en);
  const dnAlias = resolveTeamAlias(dn);

  return enAlias === dnAlias || enAlias.includes(dnAlias) || dnAlias.includes(enAlias);
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
const NBA_ABBR_MAP = {
  'atlanta hawks': 'atl',
  'boston celtics': 'bos',
  'brooklyn nets': 'bkn',
  'charlotte hornets': 'cha',
  'chicago bulls': 'chi',
  'cleveland cavaliers': 'cle',
  'dallas mavericks': 'dal',
  'denver nuggets': 'den',
  'detroit pistons': 'det',
  'golden state warriors': 'gs',
  'houston rockets': 'hou',
  'indiana pacers': 'ind',
  'los angeles clippers': 'lac',
  'la clippers': 'lac',
  'los angeles lakers': 'lal',
  'la lakers': 'lal',
  'memphis grizzlies': 'mem',
  'miami heat': 'mia',
  'milwaukee bucks': 'mil',
  'minnesota timberwolves': 'min',
  'new orleans pelicans': 'no',
  'new york knicks': 'ny',
  'oklahoma city thunder': 'okc',
  'orlando magic': 'orl',
  'philadelphia 76ers': 'phi',
  'phoenix suns': 'phx',
  'portland trail blazers': 'por',
  'sacramento kings': 'sac',
  'san antonio spurs': 'sa',
  'toronto raptors': 'tor',
  'utah jazz': 'utah',
  'washington wizards': 'wsh',
};

async function fetchEventFromTeamSchedule(espnSport, teamNameEn, dateStr) {
  const { sport, league } = ESPN_SPORTS[espnSport];
  const key  = teamNameEn.toLowerCase().replace(/\s+w$/i, '').trim();
  const abbr = WNBA_ABBR_MAP[key] || NBA_ABBR_MAP[key];

  if (!abbr) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${abbr}/schedule?season=2026`;

  try {
    const res = await fetch(url);
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
    const res = await fetch(url);
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

  for (const rosterGroup of rosters) {
    const teamName = rosterGroup.team?.displayName || rosterGroup.team?.name || '';
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    const starters = (rosterGroup.roster || [])
      .filter(p => p.starter && p.batOrder && p.position?.abbreviation !== 'P')
      .sort((a, b) => a.batOrder - b.batOrder);

    for (const p of starters) {
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos = p.position?.abbreviation || '';
      const id = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png` : '';

      const sm = {};
      (p.stats || []).forEach(s => { sm[s.name] = s.displayValue; });

      const avg = sm['avg'] || '.000';
      let line = `${p.batOrder}번 ${name} (${pos})`;

      if (photo) line += `|${photo}`;
      result[side].push(line);
    }
  }

  const comp = event?.competitions?.[0];

  for (const competitor of (comp?.competitors || [])) {
    const teamName = competitor.team?.displayName || competitor.team?.name || '';
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    for (const prob of (competitor.probables || [])) {
      const name = prob.athlete?.shortName || '';
      const record = prob.record || '';
      const eraStat = (prob.statistics || []).find(s => s.abbreviation === 'ERA');
      const era = eraStat?.displayValue || '';
      const probId = prob.athlete?.id || '';
      const photo = probId ? `https://a.espncdn.com/i/headshots/mlb/players/full/${probId}.png` : '';

      if (name) {
        let line = `선발투수 ${name}`;

        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era) line += ` ERA ${era}`;
        if (photo) line += `|${photo}`;

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
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    if (rosterGroup.formation) {
      if (isHome) result.homeFormation = rosterGroup.formation;
      else result.awayFormation = rosterGroup.formation;
    }

    const starters = (rosterGroup.roster || [])
      .filter(p => p.starter)
      .sort((a, b) => (a.jerseyNumber || 0) - (b.jerseyNumber || 0));

    for (const p of starters) {
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos = p.position?.abbreviation || '';
      const id = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png` : '';

      if (name) result[side].push(`${name} (${pos})${photo ? '|' + photo : ''}`);
    }

    if (!rosterGroup.formation) {
      const derived = deriveFormationFromLineup(
        starters.map(p => ({ position: p.position?.abbreviation || '' }))
      );

      if (derived) {
        if (isHome) result.homeFormation = derived;
        else result.awayFormation = derived;
      }
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
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    const starters = (rosterGroup.roster || []).filter(p => p.starter);

    for (const p of starters) {
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos = p.position?.abbreviation || '';
      const id = p.athlete?.id || '';
      const photo = id ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : '';

      const sm = {};
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
// 농구: 경기 종료 후 대비 - boxscore.players에서 선발 추출
// ─────────────────────────────────────────────
function parseBasketballBoxscoreStarters(summary, homeTeamEn, awayTeamEn) {
  const players = summary?.boxscore?.players;
  if (!players || players.length === 0) return null;

  const result = { home: [], away: [] };

  for (const teamBlock of players) {
    const teamName = teamBlock.team?.displayName || teamBlock.team?.name || '';
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    const athleteEntries = teamBlock.statistics?.[0]?.athletes || [];
    const starters = athleteEntries.filter(p => p.starter);

    for (const p of starters) {
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos = p.athlete?.position?.abbreviation || '';
      const id = p.athlete?.id || '';
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
  const comp = event.competitions?.[0];
  const result = { home: [], away: [] };

  if (!comp) return result;

  for (const competitor of (comp.competitors || [])) {
    const teamName = competitor.team?.displayName || competitor.team?.name || '';
    const isHome = matchTeam(teamName, homeTeamEn);
    const side = isHome ? 'home' : 'away';

    for (const prob of (competitor.probables || [])) {
      const name = prob.athlete?.shortName || '';
      const record = prob.record || '';
      const eraStat = (prob.statistics || []).find(s => s.abbreviation === 'ERA');
      const era = eraStat?.displayValue || '';
      const probId = prob.athlete?.id || '';
      const photo = probId ? `https://a.espncdn.com/i/headshots/mlb/players/full/${probId}.png` : '';

      if (name) {
        let line = `선발투수 ${name}`;

        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era) line += ` ERA ${era}`;
        if (photo) line += `|${photo}`;

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
  let content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!fmMatch) {
    console.warn(`⚠️ frontmatter 없음: ${filePath}`);
    return false;
  }

  let fm = fmMatch[1];

  for (const [key, value] of Object.entries(updates)) {
    const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const regex = new RegExp(`^${key}:.*$`, 'm');

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
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) return {};

  const fm = {};

  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }

  return fm;
}

function getKstDates() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const offsets = [-2, -1, 0, 1, 2];

  return offsets.map(n =>
    new Date(now.getTime() + n * 86400000).toISOString().slice(0, 10)
  );
}

function getTargetPostFiles() {
  const targetDates = getKstDates();

  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && targetDates.some(d => f.startsWith(d)))
    .map(f => path.join(POSTS_DIR, f));
}

// ─────────────────────────────────────────────
// NBA 썸머리그 도시 키
// ─────────────────────────────────────────────
const SUMMER_LEAGUE_CITY_KEYS = [
  'basketball_summer_utah',
  'basketball_summer_lasvegas',
  'basketball_summer_orlando',
  'basketball_summer_sacramento',
];

// ─────────────────────────────────────────────
// 기존에 저장된 라인업(frontmatter 문자열)을 배열로 복원
// ─────────────────────────────────────────────
function parseStoredLineupArray(raw) {
  const unescaped = (raw || '').replace(/\\"/g, '"').trim();

  if (!unescaped || unescaped === '[]') return [];

  try {
    const arr = JSON.parse(unescaped);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function extractPositionsFromStoredLineup(rawLineup) {
  const items = parseStoredLineupArray(rawLineup);

  return items.map(line => {
    const m = String(line).match(/\(([^)]+)\)/);
    return { position: m ? m[1].trim() : '' };
  });
}

// ─────────────────────────────────────────────
// 기존 라인업 + 신규 응답 병합
// ─────────────────────────────────────────────
function mergeLineupSide(oldRaw, newArr, category) {
  const oldArr = parseStoredLineupArray(oldRaw);
  const newSafe = Array.isArray(newArr) ? newArr : [];

  if (category !== 'baseball') {
    return newSafe.length > 0 ? newSafe : oldArr;
  }

  const isPitcherLine = line =>
    typeof line === 'string' && line.startsWith('선발투수');

  const hasPhoto = line =>
    typeof line === 'string' && line.includes('|');

  const oldPitcher = oldArr.find(isPitcherLine) || null;
  const oldBatters = oldArr.filter(l => !isPitcherLine(l));

  const newPitcher = newSafe.find(isPitcherLine) || null;
  const newBatters = newSafe.filter(l => !isPitcherLine(l));

  let finalPitcher;

  if (newPitcher && (hasPhoto(newPitcher) || !oldPitcher)) {
    finalPitcher = newPitcher;
  } else if (oldPitcher) {
    finalPitcher = oldPitcher;
  } else {
    finalPitcher = newPitcher;
  }

  const finalBatters = newBatters.length > 0 ? newBatters : oldBatters;

  return finalPitcher ? [finalPitcher, ...finalBatters] : finalBatters;
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
  let skipCount = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    const category = fm.category || '';

    // ─────────────────────────────────────────────
    // 라인업 완료 여부 판정
    // ─────────────────────────────────────────────
    const isLineupComplete = (rawLineup) => {
      const unescaped = (rawLineup || '').replace(/\\"/g, '"').trim();

      // 빈 값 및 빈 라인업 표시값 확인
      const isEmptyLineup =
        !unescaped ||
        unescaped === '[]' ||
        unescaped === "''" ||
        unescaped === '""' ||
        unescaped === 'null';

      // 1. 야구
      if (category === 'baseball') {
        const hasBatters =
          !isEmptyLineup && unescaped.includes('번 ');

        const pitcherMatch = unescaped.match(/선발투수[^"]*/);

        const hasPitcherPhoto = !!(
          pitcherMatch && pitcherMatch[0].includes('|')
        );

        return hasBatters && hasPitcherPhoto;
      }

      // 2. 농구
      // 실제 선수 배열이 5명 이상 있어야 완료로 판정
      if (category === 'basketball') {
        const arr = parseStoredLineupArray(rawLineup);

        const validPlayers = arr.filter(line =>
          typeof line === 'string' && line.trim() !== ''
        );

        return validPlayers.length >= 5;
      }

      // 3. 그 외 종목
      const hasBatters = !isEmptyLineup;

      // 축구는 전부 SUB 또는 포지션 없음이면 미완료
      const isAllSubOrEmpty = category === 'soccer' && hasBatters && (() => {
        try {
          const arr = JSON.parse(unescaped);

          if (!Array.isArray(arr) || arr.length === 0) return true;

          return arr.every(line => {
            const m = String(line).match(/\(([^)]+)\)/);
            const pos = m ? m[1].trim().toUpperCase() : '';

            return pos === 'SUB' || pos === '';
          });
        } catch {
          return false;
        }
      })();

      return hasBatters && !isAllSubOrEmpty;
    };

    const isEmptyField = raw =>
      !raw || raw.trim().replace(/^['"]|['"]$/g, '').trim() === '';

    let needsFormation = false;
    let fallbackHomeFormation = '';
    let fallbackAwayFormation = '';

    console.log(`   [라인업 판정 진단] ${path.basename(filePath)}`);
    console.log(`   category: ${category}`);
    console.log(`   homeLineup 원본: ${JSON.stringify(fm.homeLineup)}`);
    console.log(`   awayLineup 원본: ${JSON.stringify(fm.awayLineup)}`);
    console.log(`   homeLineup 파싱: ${JSON.stringify(parseStoredLineupArray(fm.homeLineup))}`);
    console.log(`   awayLineup 파싱: ${JSON.stringify(parseStoredLineupArray(fm.awayLineup))}`);
    console.log(`   홈 완료 판정: ${isLineupComplete(fm.homeLineup)}`);
    console.log(`   원정 완료 판정: ${isLineupComplete(fm.awayLineup)}`);

    if (isLineupComplete(fm.homeLineup) && isLineupComplete(fm.awayLineup)) {
      needsFormation = category === 'soccer'
        && (isEmptyField(fm.homeFormation) || isEmptyField(fm.awayFormation));

      if (!needsFormation) {
        console.log(`⏩ [스킵] 라인업 완료: ${path.basename(filePath)}`);
        skipCount++;
        continue;
      }

      if (isEmptyField(fm.homeFormation)) {
        fallbackHomeFormation =
          deriveFormationFromLineup(extractPositionsFromStoredLineup(fm.homeLineup)) || '';
      }

      if (isEmptyField(fm.awayFormation)) {
        fallbackAwayFormation =
          deriveFormationFromLineup(extractPositionsFromStoredLineup(fm.awayLineup)) || '';
      }

      if (fallbackHomeFormation || fallbackAwayFormation) {
        console.log(
          `ℹ️ [저장된 라인업으로 포메이션 유추] ${path.basename(filePath)} | 홈 ${fallbackHomeFormation || '실패'} / 원정 ${fallbackAwayFormation || '실패'}`
        );

        const immediateUpdates = {};

        if (fallbackHomeFormation) immediateUpdates.homeFormation = fallbackHomeFormation;
        if (fallbackAwayFormation) immediateUpdates.awayFormation = fallbackAwayFormation;

        const savedNow = updateMdFrontmatter(filePath, immediateUpdates);

        if (savedNow) {
          updatedCount++;

          if (fallbackHomeFormation) fm.homeFormation = fallbackHomeFormation;
          if (fallbackAwayFormation) fm.awayFormation = fallbackAwayFormation;
        }
      }

      console.log(`ℹ️ [계속 진행] 라인업은 완료됐지만 포메이션이 비어있어 재조회: ${path.basename(filePath)}`);
    }

    const league = fm.league || '';
    const homeTeamKo = fm.homeTeam || '';
    const awayTeamKo = fm.awayTeam || '';

    const homeTeamEn = toEnglishTeamName(homeTeamKo);
    const awayTeamEn = toEnglishTeamName(awayTeamKo);

    if (!fm.date || isNaN(new Date(fm.date))) {
      console.log(`⚠️ [스킵] frontmatter date 파싱 실패: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    const utcDateStr = new Date(fm.date).toISOString().slice(0, 10);

    const espnSportGuess = detectEspnSport(category, league, fm.country, fm.date);

    if (!espnSportGuess || espnSportGuess === 'wnba') {
      skipCount++;
      continue;
    }

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${homeTeamKo} → ${homeTeamEn}`);
    console.log(`   원정: ${awayTeamKo} → ${awayTeamEn}`);
    console.log(`   날짜(UTC): ${utcDateStr} / 리그: "${league}"`);

    let espnSport = espnSportGuess;
    let matched = null;

    const prevUtcDateStr = new Date(
      new Date(`${utcDateStr}T00:00:00Z`).getTime() - 86400000
    ).toISOString().slice(0, 10);

    const nextUtcDateStr = new Date(
  new Date(`${utcDateStr}T00:00:00Z`).getTime() + 86400000
).toISOString().slice(0, 10);

const dateCandidates = [
  utcDateStr,
  prevUtcDateStr,
  nextUtcDateStr
];

    if (SUMMER_LEAGUE_CITY_KEYS.includes(espnSportGuess)) {
      outer:
      for (const d of dateCandidates) {
        for (const cityKey of SUMMER_LEAGUE_CITY_KEYS) {
          const cacheKey = `${cityKey}_${d}`;

          if (!(cacheKey in eventCache)) {
            console.log(`   📡 스코어보드 호출: ${ESPN_SPORTS[cityKey].label} / ${d}`);
            eventCache[cacheKey] = await fetchEspnEvents(cityKey, d);
            await new Promise(r => setTimeout(r, 500));
          }

          const found = findMatchingEvent(
            eventCache[cacheKey],
            homeTeamEn,
            awayTeamEn
          );

          if (found) {
            matched = found;
            espnSport = cityKey;

            console.log(`   ✅ 도시 확인됨: ${ESPN_SPORTS[cityKey].label} (조회 날짜: ${d})`);
            break outer;
          }
        }
      }
    } else {
      for (const d of dateCandidates) {
        const cacheKey = `${espnSport}_${d}`;

        if (!(cacheKey in eventCache)) {
          console.log(`   📡 스코어보드 호출: ${d}`);
          eventCache[cacheKey] = await fetchEspnEvents(espnSport, d);
          await new Promise(r => setTimeout(r, 800));
        }

        matched = findMatchingEvent(
          eventCache[cacheKey],
          homeTeamEn,
          awayTeamEn
        );

        if (matched) {
          if (d !== utcDateStr) {
            console.log(`   ✅ 하루 전 날짜(${d})에서 찾음 (ESPN 날짜 분류 기준 차이)`);
          }

          break;
        }
      }
    }

    if (!matched) {
      console.log(`   🔄 팀 스케줄 API로 재시도...`);

      const scheduleEvents =
        await fetchEventFromTeamSchedule(espnSport, homeTeamEn, utcDateStr) ||
        await fetchEventFromTeamSchedule(espnSport, awayTeamEn, utcDateStr);

      if (scheduleEvents?.length > 0) {
        matched = findMatchingEvent(
          scheduleEvents,
          homeTeamEn,
          awayTeamEn
        );
      }
    }

    if (!matched) {
      console.log(`   ⚠️ 경기 매칭 실패`);

      const keysToCheck = SUMMER_LEAGUE_CITY_KEYS.includes(espnSportGuess)
        ? dateCandidates.flatMap(d =>
            SUMMER_LEAGUE_CITY_KEYS.map(k => `${k}_${d}`)
          )
        : dateCandidates.map(d => `${espnSport}_${d}`);

      const todaysEspnTeams = keysToCheck.flatMap(k =>
        (eventCache[k] || []).flatMap(e => {
          const comp = e.competitions?.[0];

          return (comp?.competitors || []).map(
            c => c.team?.displayName || c.team?.name || ''
          );
        })
      );

      console.log(`   [진단] 우리 팀명: "${homeTeamEn}" / "${awayTeamEn}"`);
      console.log(
        `   [진단] ESPN이 그 기간(±1일) 쓴 팀명 목록: ${JSON.stringify([...new Set(todaysEspnTeams)])}`
      );

      const fallbackUpdates = {};

      if (fallbackHomeFormation) fallbackUpdates.homeFormation = fallbackHomeFormation;
      if (fallbackAwayFormation) fallbackUpdates.awayFormation = fallbackAwayFormation;

      if (Object.keys(fallbackUpdates).length > 0) {
        const ok = updateMdFrontmatter(filePath, fallbackUpdates);

        if (ok) {
          console.log(
            `   🔄 [경기 매칭 실패했지만 포메이션만 반영] 홈 ${fallbackHomeFormation || '-'} / 원정 ${fallbackAwayFormation || '-'}`
          );

          updatedCount++;
          continue;
        }
      }

      skipCount++;
      continue;
    }

    const { event, comp } = matched;
    const gameId = event.id;
    const status = comp.status?.type?.state || '';

    console.log(`   ✅ 매칭 성공 gameId: ${gameId} (상태: ${status})`);

    const summary = await fetchSummary(espnSport, gameId);
    await new Promise(r => setTimeout(r, 1200));

    let homeLineup = [];
    let awayLineup = [];
    const updates = {};

    if (espnSport === 'baseball') {
      const parsed = summary
        ? parseBaseballRosters(summary, event, homeTeamEn, awayTeamEn)
        : null;

      if (parsed) {
        homeLineup = parsed.home;
        awayLineup = parsed.away;
      } else {
        const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);

        homeLineup = leaders.home;
        awayLineup = leaders.away;
      }
    } else if (
      espnSport === 'basketball' ||
      espnSport.startsWith('basketball_summer') ||
      espnSport === 'wnba'
    ) {
      let parsed = summary
        ? parseBasketballRosters(summary, homeTeamEn, awayTeamEn)
        : null;

      if (!parsed) {
        parsed = summary
          ? parseBasketballBoxscoreStarters(summary, homeTeamEn, awayTeamEn)
          : null;
      }

      if (parsed) {
        homeLineup = parsed.home;
        awayLineup = parsed.away;
      } else {
        const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);

        homeLineup = leaders.home;
        awayLineup = leaders.away;
      }
    } else if (espnSport.startsWith('soccer_')) {
      const parsed = summary
        ? parseSoccerRosters(summary, homeTeamEn, awayTeamEn)
        : null;

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

      if (!updates.homeFormation && fallbackHomeFormation) {
        updates.homeFormation = fallbackHomeFormation;
      }

      if (!updates.awayFormation && fallbackAwayFormation) {
        updates.awayFormation = fallbackAwayFormation;
      }
    } else {
      const leaders = parseLeadersFromEvent(event, homeTeamEn, awayTeamEn);

      homeLineup = leaders.home;
      awayLineup = leaders.away;
    }

    if (homeLineup.length === 0 && awayLineup.length === 0) {
      console.log(`   ⚠️ 라인업 데이터 없음`);

      if (
        (espnSport === 'basketball' ||
          espnSport.startsWith('basketball_summer') ||
          espnSport === 'wnba') &&
        summary
      ) {
        const players = summary?.boxscore?.players;

        console.log(
          `   [진단] boxscore.players 존재: ${!!players} / 길이: ${players?.length ?? 'N/A'}`
        );

        if (players && players.length > 0) {
          const firstTeamAthletes = players[0]?.statistics?.[0]?.athletes;

          console.log(
            `   [진단] 첫 팀 athletes 길이: ${firstTeamAthletes?.length ?? 'N/A'} / starter 필드 존재 예시: ${JSON.stringify(firstTeamAthletes?.[0]?.starter)}`
          );
        }

        console.log(
          `   [진단] summary?.rosters 존재: ${!!summary?.rosters} / 길이: ${summary?.rosters?.length ?? 'N/A'}`
        );
      }

      skipCount++;
      continue;
    }

    const mergedHomeLineup = mergeLineupSide(
      fm.homeLineup,
      homeLineup,
      category
    );

    const mergedAwayLineup = mergeLineupSide(
      fm.awayLineup,
      awayLineup,
      category
    );

    const mergedHomeStr = JSON.stringify(mergedHomeLineup);
    const mergedAwayStr = JSON.stringify(mergedAwayLineup);

    const oldHomeStr = JSON.stringify(parseStoredLineupArray(fm.homeLineup));
    const oldAwayStr = JSON.stringify(parseStoredLineupArray(fm.awayLineup));

    if (mergedHomeStr !== oldHomeStr) {
      updates.homeLineup = mergedHomeStr;
    } else {
      console.log(`   ℹ️ 홈 라인업 변경 없음 (기존 값 유지)`);
    }

    if (mergedAwayStr !== oldAwayStr) {
      updates.awayLineup = mergedAwayStr;
    } else {
      console.log(`   ℹ️ 원정 라인업 변경 없음 (기존 값 유지)`);
    }

    const ok = updateMdFrontmatter(filePath, updates);

    if (ok) {
      const loggedHomeCount = updates.homeLineup
        ? JSON.parse(updates.homeLineup).length
        : '기존유지';

      const loggedAwayCount = updates.awayLineup
        ? JSON.parse(updates.awayLineup).length
        : '기존유지';

      const homeFormationLog = updates.homeFormation
        ? `홈포메이션 ${updates.homeFormation}`
        : (category === 'soccer' && needsFormation
            ? '홈포메이션 실패(유추 안 됨)'
            : '홈포메이션 대상아님');

      const awayFormationLog = updates.awayFormation
        ? `원정포메이션 ${updates.awayFormation}`
        : (category === 'soccer' && needsFormation
            ? '원정포메이션 실패(유추 안 됨)'
            : '원정포메이션 대상아님');

      console.log(
        `   🔄 업데이트 완료 | 홈 ${loggedHomeCount}건 / 원정 ${loggedAwayCount}건 | ${homeFormationLog} / ${awayFormationLog}`
      );

      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();
