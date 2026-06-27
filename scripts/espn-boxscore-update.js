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
  baseball:   { sport: 'baseball',   league: 'mlb',  label: 'MLB'  },
  basketball: { sport: 'basketball', league: 'nba',  label: 'NBA'  },
  wnba:       { sport: 'basketball', league: 'wnba', label: 'WNBA' },
  hockey:     { sport: 'hockey',     league: 'nhl',  label: 'NHL'  },
  soccer_mls: { sport: 'soccer',     league: 'usa.1',label: 'MLS'  },
};

function detectEspnSport(category, league) {
  const cat = (category || '').toLowerCase();
  const lg  = (league   || '').toUpperCase();
  if (lg.includes('WNBA'))                        return 'wnba';
  if (cat === 'baseball' || lg.includes('MLB'))   return 'baseball';
  if (cat === 'basketball' || lg.includes('NBA')) return 'basketball';
  if (cat === 'hockey'   || lg.includes('NHL'))   return 'hockey';
  if (cat === 'soccer'   && lg.includes('MLS'))   return 'soccer_mls';
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
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos  = p.position?.abbreviation || '';
      const sm   = {};
      (p.stats || []).forEach(s => { sm[s.name] = s.displayValue; });
      const avg = sm['avg'] || '.000';
      result[side].push(`${p.batOrder}번 ${name} (${pos}) | 시즌타율 ${avg}`);
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
      if (name) {
        // record에 이미 괄호 포함된 경우 그대로, 없으면 괄호 추가
        let line = `선발투수 ${name}`;
        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era)    line += ` ERA ${era}`;
        result[side].unshift(line);
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
    const isHome   = matchTeam(teamName, homeTeamEn);
    const side     = isHome ? 'home' : 'away';

    const starters = (rosterGroup.roster || []).filter(p => p.starter);

    for (const p of starters) {
      const name = p.athlete?.shortName || p.athlete?.displayName || '';
      const pos  = p.position?.abbreviation || '';
      const sm   = {};
      (p.stats || []).forEach(s => { sm[s.name] = s.displayValue; });
      const ppg = sm['avgPoints'] || sm['points'] || '';
      let line = `${name} (${pos})`;
      if (ppg) line += ` | 평균 ${ppg}점`;
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
      if (name) {
        let line = `선발투수 ${name}`;
        if (record) line += record.startsWith('(') ? ` ${record}` : ` (${record})`;
        if (era)    line += ` ERA ${era}`;
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
  return [today, yesterday];
}

function getTargetPostFiles() {
  const [today, yesterday] = getKstDates();
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && (f.startsWith(today) || f.startsWith(yesterday)))
    .map(f => path.join(POSTS_DIR, f));
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
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

    // 타자 데이터(번 타순)가 있으면 완료된 것으로 스킵, 선발투수만 있으면 재실행
    const existingLineup = fm.homeLineup || '';
    const hasBatters = existingLineup.includes('번 ');
    if (hasBatters) {
      console.log(`⏩ [스킵] 타자 라인업 완료: ${path.basename(filePath)}`);
      skipCount++;
      continue;
    }

    const category  = fm.category  || '';
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
    const espnSport  = detectEspnSport(category, league);

    if (!espnSport) {
      console.log(`⏩ [스킵] ESPN 미지원 종목: ${category} / ${league}`);
      skipCount++;
      continue;
    }

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${homeTeamKo} → ${homeTeamEn}`);
    console.log(`   원정: ${awayTeamKo} → ${awayTeamEn}`);
    console.log(`   날짜(KST): ${dateStr} / 종목: ${ESPN_SPORTS[espnSport].label}`);

    // 스코어보드 조회 (캐시)
    const cacheKey = `${espnSport}_${dateStr}`;
    if (!eventCache[cacheKey]) {
      console.log(`   📡 스코어보드 호출: ${dateStr}`);
      eventCache[cacheKey] = await fetchEspnEvents(espnSport, dateStr);
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

    const ok = updateMdFrontmatter(filePath, {
      homeLineup: JSON.stringify(homeLineup),
      awayLineup: JSON.stringify(awayLineup),
    });

    if (ok) {
      console.log(`   🔄 업데이트 완료 | 홈 ${homeLineup.length}건 / 원정 ${awayLineup.length}건`);
      updatedCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main();