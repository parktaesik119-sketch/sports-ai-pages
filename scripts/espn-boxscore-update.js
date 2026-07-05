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
  for (const [, en, ko] of pairs) {
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
};

function detectEspnSport(category, league) {
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
    if (lg.includes('라리가') && !lg.includes('라리가2')) return 'soccer_laliga';
    if (lg.includes('분데스리가2'))  return 'soccer_bundesliga2';
    if (lg.includes('분데스리가') && !lg.includes('분데스리가2')) return 'soccer_bundesliga';
    if (lg.includes('프리메라리가')) return 'soccer_primeira';
    if (lg.includes('UEFA 챔피언스리그') || lg.includes('UEFA CHAMPIONS')) return 'soccer_ucl';
    if (lg.includes('UEFA 유로파리그') || lg.includes('UEFA EUROPA')) return 'soccer_uel';
    if (lg.includes('FIFA 월드컵') || lg.includes('FIFA WORLD') ||
        (lg.includes('월드컵') && !lg.includes('(W)') && !lg.includes('예선'))) return 'soccer_worldcup';
    if (lg.includes('P.L'))          return 'soccer_epl';
    if (lg.includes('세리에 A'))     return 'soccer_seriea';
    if (lg.includes('리그1'))        return 'soccer_ligue1';
    if (lg.includes('에레디비시'))   return 'soccer_eredivisie';
    // K1(K리그)은 ESPN 커버리지가 부실해서(매칭 100% 실패 확인됨) 제외 - API 호출 낭비 방지
    // if (lg.includes('K1'))           return 'soccer_kleague';
  }
  return null;
}

// ─────────────────────────────────────────────
// 팀명 정규화
// ─────────────────────────────────────────────
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
  return en === dn || en.includes(dn) || dn.includes(en);
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

function getKstDates() {
  const now       = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today     = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow  = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  return [today, yesterday, tomorrow];
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

// 홈/원정 영문 팀명 + 날짜로 원본(도시 정보 포함) 리그명 찾기. 못 찾으면 null.
function findRawLeagueName(dateStr, homeTeamEn, awayTeamEn) {
  const fixtures = loadRawFixtures(dateStr);
  if (!fixtures) return null;
  const found = fixtures.find(m =>
    (normalizeTeamForMatch(m.home) === normalizeTeamForMatch(homeTeamEn) && normalizeTeamForMatch(m.away) === normalizeTeamForMatch(awayTeamEn)) ||
    (normalizeTeamForMatch(m.home) === normalizeTeamForMatch(awayTeamEn) && normalizeTeamForMatch(m.away) === normalizeTeamForMatch(homeTeamEn))
  );
  return found ? (found.league || null) : null;
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
    const category  = fm.category  || '';
    const existingLineup = fm.homeLineup || '';
    const unescapedLineup = existingLineup.replace(/\\"/g, '"').trim();
    const hasBatters = category === 'baseball'
      ? unescapedLineup.includes('번 ')
      : (unescapedLineup !== '' && unescapedLineup !== '[]');
    const pitcherMatch = unescapedLineup.match(/선발투수[^"]*/);
    const hasPitcherPhoto = category === 'baseball'
      ? !!(pitcherMatch && pitcherMatch[0].includes('|'))
      : true; // 야구 아니면 이 조건 자체가 무관하므로 항상 통과
    if (hasBatters && hasPitcherPhoto) {
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

    // 표시용 리그명이 "NBA 썸머리그"로 뭉개져서 도시 구분이 안 될 때만,
    // 원본 raw fixtures 파일을 다시 대조해서 실제 도시가 들어간 리그명으로 재감지
    let detectLeague = league;
    if (league.includes('썸머리그') || league.includes('서머리그') || league === 'California Classic') {
      const rawLeague = findRawLeagueName(dateStr, homeTeamEn, awayTeamEn);
      if (rawLeague) {
        detectLeague = rawLeague;
        console.log(`   ℹ️ 썸머리그 도시 대조: 표시="${league}" → 원본="${rawLeague}"`);
      } else {
        console.log(`   ⚠️ 썸머리그 원본 대조 실패 - database/${dateStr}.json에서 못 찾음 (라스베가스로 기본 처리)`);
      }
    }
    const espnSport  = detectEspnSport(category, detectLeague);

    if (!espnSport || espnSport === 'wnba') {
  skipCount++;
  continue;
}

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${homeTeamKo} → ${homeTeamEn}`);
    console.log(`   원정: ${awayTeamKo} → ${awayTeamEn}`);
    console.log(`   날짜(KST): ${dateStr} / 종목: ${ESPN_SPORTS[espnSport].label}`);

    // 스코어보드 조회 (캐시)
    const utcDateStr = new Date(`${dateStr}T00:00:00+09:00`).toISOString().slice(0, 10);
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
    } else if (espnSport === 'basketball' || espnSport === 'wnba') {
      const parsed = summary ? parseBasketballRosters(summary, homeTeamEn, awayTeamEn) : null;
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
      skipCount++;
      continue;
    }

    updates.homeLineup = JSON.stringify(homeLineup);
    updates.awayLineup = JSON.stringify(awayLineup);

    const ok = updateMdFrontmatter(filePath, updates);

    if (ok) {
      console.log(`   🔄 업데이트 완료 | 홈 ${homeLineup.length}건 / 원정 ${awayLineup.length}건`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();