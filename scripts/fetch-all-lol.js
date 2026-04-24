import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ==========================
// 📁 경로 및 설정
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, "../database");
const ALL_FIXTURES_FILE = path.join(OUTPUT_DIR, "all-fixtures.json");

// API 키 설정
const API_SPORTS_KEY = "8e49b25e545ea6bff12f75a858c89529";
const PANDASCORE_KEY = "GfxE_2NtG9NN2bI-TW2NobkbeSXIFNLleuR5M4Nz6kgRHs9zxnY";
const ODDS_API_KEY = "3d7903bd16bdc5cd23fea5cd05a23692";
const RAPID_KEY = "749bc19777msh67bb1920124b5d7p1cf477jsn772cbb1ccdd3";

// 호스트 설정
const API_SPORTS_BASE = {
  soccer: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};
const RAPID_LOL_HOST = "esportapi1.p.rapidapi.com";
const RAPID_SOCCER_HOST = "free-api-live-football-data.p.rapidapi.com";

/**
 * 반드시 수집해야 하는 주요 축구 리그 ID 목록 (API-SPORTS 기준)
 */
const MAJOR_SOCCER_LEAGUES = [
  39, 40,   // 영국 (EPL, 챔피언십)
  140, 141, // 스페인 (라리가 1, 2)
  135, 136, // 이탈리아 (세리에 A, B)
  78, 79,   // 독일 (분데스리가 1, 2)
  61, 62,   // 프랑스 (리그 1, 2)
  307,      // 사우디 프로리그
  244,      // 핀란드 베이카우스리가
  106,      // 폴란드 엑스트라클라사
  233,      // 이집트 프리미어리그
  103,      // 노르웨이 엘리테세리엔
  71        // 브라질 세리에 A
];

// ==========================
// 🛠 유틸리티 함수
// ==========================

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/\s+/g, "").trim();
}

function getTargetDates() {
  const dates = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function getMatchedData(match, allOdds, allScores) {
  if (!match.date) return match;
  
  const matchDateObj = new Date(match.date);
  const matchDateStr = matchDateObj.toISOString().split('T')[0]; 

  const homeNorm = normalizeName(match.home);
  const awayNorm = normalizeName(match.away);

  const oddsList = Array.isArray(allOdds) ? allOdds : [];
  const oddsInfo = oddsList.find(o => {
    const oDateStr = new Date(o.commence_time).toISOString().split('T')[0];
    const oHomeNorm = normalizeName(o.home_team);
    return oDateStr === matchDateStr && (oHomeNorm.includes(homeNorm) || homeNorm.includes(oHomeNorm));
  });

  const result = {
    homeOdd: null, drawOdd: null, awayOdd: null,
    handicap: null, handicapHomeOdd: null, handicapAwayOdd: null,
    overUnder: null, overOdd: null, underOdd: null
  };

  if (oddsInfo && oddsInfo.bookmakers) {
    const targetBookie = oddsInfo.bookmakers.find(b => b.key === "onexbet") || oddsInfo.bookmakers[0];
    if (targetBookie) {
      const h2h = targetBookie.markets.find(m => m.key === "h2h");
      if (h2h) {
        result.homeOdd = h2h.outcomes.find(o => normalizeName(o.name).includes(homeNorm))?.price || null;
        result.awayOdd = h2h.outcomes.find(o => normalizeName(o.name).includes(awayNorm))?.price || null;
        result.drawOdd = h2h.outcomes.find(o => o.name.toLowerCase() === "draw")?.price || null;
      }
      const spreads = targetBookie.markets.find(m => m.key === "spreads");
      if (spreads) {
        const hOutcome = spreads.outcomes.find(o => normalizeName(o.name).includes(homeNorm));
        if (hOutcome) {
          result.handicap = hOutcome.point;
          result.handicapHomeOdd = hOutcome.price;
          result.handicapAwayOdd = spreads.outcomes.find(o => normalizeName(o.name).includes(awayNorm))?.price || null;
        }
      }
      const totals = targetBookie.markets.find(m => m.key === "totals");
      if (totals) {
        const over = totals.outcomes.find(o => o.name.toLowerCase() === "over");
        if (over) {
          result.overUnder = over.point;
          result.overOdd = over.price;
          result.underOdd = totals.outcomes.find(o => o.name.toLowerCase() === "under")?.price || null;
        }
      }
    }
  }

  const scoresList = Array.isArray(allScores) ? allScores : [];
  const scoreInfo = scoresList.find(s => {
    const sDateStr = new Date(s.commence_time).toISOString().split('T')[0];
    return sDateStr === matchDateStr && normalizeName(s.home_team).includes(homeNorm);
  });

  return {
    ...match,
    ...result,
    homeScore: scoreInfo?.scores?.find(s => normalizeName(s.name).includes(homeNorm))?.score || match.homeScore || null,
    awayScore: scoreInfo?.scores?.find(s => normalizeName(s.name).includes(awayNorm))?.score || match.awayScore || null
  };
}

// ==========================
// 📡 데이터 호출 함수
// ==========================

/**
 * 1. API-SPORTS (범용 수집)
 */
async function fetchApiSports(sport, date) {
  const url = `${API_SPORTS_BASE[sport]}/${sport === "soccer" ? "fixtures" : "games"}?date=${date}`;
  try {
    const res = await fetch(url, { headers: { "x-apisports-key": API_SPORTS_KEY } });
    const data = await res.json();
    if (!data.response) return [];
    return data.response.map(item => ({
      id: String(item.fixture?.id || item.id),
      sport,
      league: item.league.name,
      date: item.fixture?.date || item.date,
      home: item.teams.home.name,
      away: item.teams.away.name,
      homeLogo: item.teams.home.logo,
      awayLogo: item.teams.away.logo,
      homeScore: item.goals?.home ?? item.scores?.home?.total ?? null,
      awayScore: item.goals?.away ?? item.scores?.away?.total ?? null
    }));
  } catch (err) { return []; }
}

/**
 * 2. API-SPORTS (주요 리그 ID 정밀 수집)
 */
async function fetchMajorSoccerLeagues(date) {
  const tasks = MAJOR_SOCCER_LEAGUES.map(async (leagueId) => {
    const url = `${API_SPORTS_BASE.soccer}/fixtures?date=${date}&league=${leagueId}&season=2025`;
    try {
      const res = await fetch(url, { headers: { "x-apisports-key": API_SPORTS_KEY } });
      const data = await res.json();
      if (!data.response) return [];
      return data.response.map(item => ({
        id: String(item.fixture.id),
        sport: "soccer",
        league: item.league.name,
        date: item.fixture.date,
        home: item.teams.home.name,
        away: item.teams.away.name,
        homeLogo: item.teams.home.logo,
        awayLogo: item.teams.away.logo,
        homeScore: item.goals.home ?? null,
        awayScore: item.goals.away ?? null
      }));
    } catch (err) { return []; }
  });
  const results = await Promise.all(tasks);
  return results.flat();
}

/**
 * 3. [신규] RapidAPI Free Football Data (보충 수집)
 */
async function fetchRapidSoccer(date) {
  const url = `https://${RAPID_SOCCER_HOST}/api/v1/football/fixtures/date/${date}`;
  try {
    const res = await fetch(url, {
      headers: { 
        'x-rapidapi-key': RAPID_KEY, 
        'x-rapidapi-host': RAPID_SOCCER_HOST 
      }
    });
    const data = await res.json();
    if (!data?.data) return [];

    return data.data.map(item => ({
      id: `rapid-soc-${item.fixture_id}`,
      sport: "soccer",
      league: item.league_name,
      date: item.fixture_date,
      home: item.home_team_name,
      away: item.away_team_name,
      homeLogo: item.home_team_logo,
      awayLogo: item.away_team_logo,
      homeScore: item.home_team_score ?? null,
      awayScore: item.away_team_score ?? null
    }));
  } catch (err) { return []; }
}

/**
 * 4. RapidAPI LoL/LCK 수집
 */
async function fetchLckRapid(date) {
  const [y, m, d] = date.split('-');
  const dateParam = `${d}/${m}/${y}`;
  const url = `https://${RAPID_LOL_HOST}/api/esport/matches/${dateParam}`;
  try {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-key': RAPID_KEY, 'x-rapidapi-host': RAPID_LOL_HOST }
    });
    const data = await res.json();
    if (!data?.events) return [];
    return data.events
      .filter(e => (e.tournament?.category?.name?.toLowerCase() || "").includes("lol"))
      .map(e => ({
        id: `rapid-${e.id}`,
        sport: "lol",
        league: e.tournament?.name || "LoL League",
        date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
        home: e.homeTeam?.name || "TBD",
        away: e.awayTeam?.name || "TBD",
        homeLogo: "",
        awayLogo: "",
        homeScore: e.homeScore?.display ?? 0,
        awayScore: e.awayScore?.display ?? 0
      }));
  } catch (err) { return []; }
}

/**
 * 5. PandaScore LoL 수집
 */
async function fetchLOLPanda() {
  const dates = getTargetDates();
  const url = `https://api.pandascore.co/matches?range[begin_at]=${dates[0]}T00:00:00Z,${dates[dates.length-1]}T23:59:59Z`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PANDASCORE_KEY}` } });
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(m => ({
      id: `panda-${m.id}`,
      sport: "lol",
      league: m.league.name,
      date: m.begin_at,
      home: m.opponents[0]?.opponent.name || "TBD",
      away: m.opponents[1]?.opponent.name || "TBD",
      homeLogo: m.opponents[0]?.opponent.image_url,
      awayLogo: m.opponents[1]?.opponent.image_url,
      homeScore: m.results[0]?.score || 0,
      awayScore: m.results[1]?.score || 0
    }));
  } catch (err) { return []; }
}

/**
 * 6. 배당 및 실시간 스코어 수집 (The Odds API)
 */
async function fetchOddsAndScores() {
  const regions = "eu,us,au,uk";
  const markets = "h2h,spreads,totals";
  const oddsUrl = `https://api.the-odds-api.com/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;
  const scoresUrl = `https://api.the-odds-api.com/v4/sports/soccer/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
  try {
    const [oddsRes, scoresRes] = await Promise.all([fetch(oddsUrl), fetch(scoresUrl)]);
    const oddsData = await oddsRes.json();
    const scoresData = await scoresRes.json();
    return { 
      odds: Array.isArray(oddsData) ? oddsData : [], 
      scores: Array.isArray(scoresData) ? scoresData : [] 
    };
  } catch (err) { return { odds: [], scores: [] }; }
}

// ==========================
// 🚀 메인 프로세스
// ==========================
async function main() {
  try {
    const targetDates = getTargetDates(); // 어제(-1), 오늘(0), 내일(1), 모레(2)
    const sports = ["soccer", "basketball", "baseball", "hockey", "volleyball"];
    const scheduleTasks = [];

    targetDates.forEach(date => {
      // 종목별 범용 수집
      sports.forEach(sport => scheduleTasks.push(fetchApiSports(sport, date)));
      
      // 축구 주요 리그 정밀 수집
      scheduleTasks.push(fetchMajorSoccerLeagues(date));

      // [신규] Rapid Soccer API 수집 (보충용)
      scheduleTasks.push(fetchRapidSoccer(date));

      // LoL RapidAPI 수집
      scheduleTasks.push(fetchLckRapid(date));
    });
    
    // LoL PandaScore 수집
    scheduleTasks.push(fetchLOLPanda());

    // 모든 API 동시 실행
    const [rawResults, oddsAndScores] = await Promise.all([
      Promise.all(scheduleTasks),
      fetchOddsAndScores()
    ]);

    // 평탄화 및 배당 매칭
    const mergedData = rawResults.flat().map(m => getMatchedData(m, oddsAndScores.odds, oddsAndScores.scores));

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    let existing = [];
    try { 
      const content = await fs.readFile(ALL_FIXTURES_FILE, "utf-8");
      existing = JSON.parse(content || "[]");
    } catch (e) {}

    // 중복 제거 및 데이터 업데이트용 Map
    const map = new Map();
    existing.forEach(m => {
      if (!m.date) return;
      const dKey = new Date(m.date).toISOString().split("T")[0];
      const key = `${dKey}_${normalizeName(m.home)}_${normalizeName(m.away)}`;
      map.set(key, m);
    });

    mergedData.forEach(newMatch => {
      if (!newMatch.date) return;
      const dKey = new Date(newMatch.date).toISOString().split("T")[0];
      const key = `${dKey}_${normalizeName(newMatch.home)}_${normalizeName(newMatch.away)}`;
      
      if (map.has(key)) {
        const oldMatch = map.get(key);
        map.set(key, {
          ...oldMatch,
          ...newMatch,
          homeScore: (newMatch.homeScore !== null) ? newMatch.homeScore : oldMatch.homeScore,
          awayScore: (newMatch.awayScore !== null) ? newMatch.awayScore : oldMatch.awayScore,
          homeOdd: newMatch.homeOdd || oldMatch.homeOdd,
          awayOdd: newMatch.awayOdd || oldMatch.awayOdd,
          drawOdd: newMatch.drawOdd || oldMatch.drawOdd,
          handicap: newMatch.handicap || oldMatch.handicap,
          handicapHomeOdd: newMatch.handicapHomeOdd || oldMatch.handicapHomeOdd,
          handicapAwayOdd: newMatch.handicapAwayOdd || oldMatch.handicapAwayOdd,
          overUnder: newMatch.overUnder || oldMatch.overUnder,
          overOdd: newMatch.overOdd || oldMatch.overOdd,
          underOdd: newMatch.underOdd || oldMatch.underOdd
        });
      } else {
        map.set(key, newMatch);
      }
    });

    const finalAllFixtures = Array.from(map.values());
    finalAllFixtures.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 전체 데이터 파일 저장
    await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(finalAllFixtures, null, 2));

    // 당일 수집된 데이터 캐시 저장
    const todayStr = new Date().toISOString().split("T")[0];
    await fs.writeFile(path.join(OUTPUT_DIR, `${todayStr}.json`), JSON.stringify(mergedData, null, 2));

    console.log(`✅ 업데이트 완료: 총 ${finalAllFixtures.length}건 데이터 통합 관리 중 (Rapid Soccer API 포함)`);
  } catch (err) {
    console.error("❌ 통합 프로세스 에러:", err.stack);
  }
}

main();