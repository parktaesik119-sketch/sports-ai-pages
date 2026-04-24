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

const API_SPORTS_BASE = {
  soccer: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};

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

/**
 * 배당 및 스코어 매칭 로직 (상세 버전 복구)
 */
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

async function fetchLeaguepedia() {
  const dates = getTargetDates();
  const fields = "SG.DateTime_UTC, SG.Team1, SG.Team2, SG.Team1Score, SG.Team2Score, SG.Tournament, SG.MatchId";
  const where = `SG.DateTime_UTC >= "${dates[0]} 00:00:00" AND SG.DateTime_UTC <= "${dates[dates.length-1]} 23:59:59"`;
  const url = `https://lol.fandom.com/api.php?action=cargoquery&tables=ScoreboardGames=SG&fields=${fields}&where=${where}&limit=500&format=json`;

  try {
    const res = await fetch(url, { 
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } 
    });
    const data = await res.json();
    if (!data || !data.cargoquery) return [];

    // [수정 포인트] map 실행 전 DateTime_UTC가 있는 데이터만 필터링합니다.
    const results = data.cargoquery
      .filter(item => item.title && item.title.DateTime_UTC) 
      .map(item => {
        const match = item.title;
        return {
          id: `lp-${match.MatchId || match.DateTime_UTC}`,
          sport: "lol",
          league: match.Tournament,
          date: match.DateTime_UTC.replace(" ", "T") + "Z",
          home: match.Team1,
          away: match.Team2,
          homeLogo: "", 
          awayLogo: "",
          homeScore: parseInt(match.Team1Score) || 0,
          awayScore: parseInt(match.Team2Score) || 0
        };
      });

    console.log(`✅ [Leaguepedia] ${results.length}개의 유효한 일정을 처리했습니다.`);
    return results;
  } catch (err) {
    console.error("[Leaguepedia LOL] 에러 발생:", err.message);
    return [];
  }
}

async function fetchOddsAndScores() {
  const regions = "eu,us,au,uk";
  const markets = "h2h,spreads,totals";
  const oddsUrl = `https://api.the-odds-api.com/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;
  const scoresUrl = `https://api.the-odds-api.com/v4/sports/soccer/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;

  try {
    const [oddsRes, scoresRes] = await Promise.all([fetch(oddsUrl), fetch(scoresUrl)]);
    const oddsData = await oddsRes.json();
    const scoresData = await scoresRes.json();
    return { odds: Array.isArray(oddsData) ? oddsData : [], scores: Array.isArray(scoresData) ? scoresData : [] };
  } catch (err) { return { odds: [], scores: [] }; }
}

// ==========================
// 🚀 메인 프로세스
// ==========================
async function main() {
  try {
    const targetDates = getTargetDates();
    const sports = ["soccer", "basketball", "baseball", "hockey", "volleyball"];
    const scheduleTasks = [];

    targetDates.forEach(date => {
      sports.forEach(sport => scheduleTasks.push(fetchApiSports(sport, date)));
    });
    scheduleTasks.push(fetchLOLPanda());
    scheduleTasks.push(fetchLeaguepedia());

    const [rawResults, oddsAndScores] = await Promise.all([
      Promise.all(scheduleTasks),
      fetchOddsAndScores()
    ]);

    const mergedData = rawResults.flat().map(m => getMatchedData(m, oddsAndScores.odds, oddsAndScores.scores));

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    let existing = [];
    try { 
      const content = await fs.readFile(ALL_FIXTURES_FILE, "utf-8");
      existing = JSON.parse(content || "[]");
    } catch (e) {}

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

    await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(finalAllFixtures, null, 2));

    const todayStr = new Date().toISOString().split("T")[0];
    await fs.writeFile(path.join(OUTPUT_DIR, `${todayStr}.json`), JSON.stringify(mergedData, null, 2));

    console.log(`✅ 업데이트 완료: 총 ${finalAllFixtures.length}건 데이터 관리 중`);
  } catch (err) {
    console.error("❌ 에러:", err.stack);
  }
}

main();