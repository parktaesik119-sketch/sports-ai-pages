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

const RAPID_HOST = "free-api-live-football-data.p.rapidapi.com";

// ==========================
// 🛠 유틸리티 함수
// ==========================
function getTargetDates() {
  const dates = [];
  for (let i = 0; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

// ==========================
// ⚽ 축구 수집 (RapidAPI & Team Logo API 적용)
// ==========================
async function fetchSoccerMatches(date) {
  const apiDate = date.replace(/-/g, ""); // YYYYMMDD 형식으로 변환
  const url = `https://${RAPID_HOST}/football-get-matches-by-date?date=${apiDate}`;
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPID_KEY,
        "x-rapidapi-host": RAPID_HOST
      }
    });
    const result = await response.json();
    const matches = result.response?.matches || [];

    return matches.map(m => ({
      id: String(m.id),
      sport: "soccer",
      league: m.leagueName || "기타 리그",
      date: m.status?.utcTime || m.time,
      home: m.home?.name || "미정",
      away: m.away?.name || "미정",
      // 알려주신 Team Logo API 적용
      homeLogo: `https://${RAPID_HOST}/football-team-logo?teamid=${m.home?.id}`,
      awayLogo: `https://${RAPID_HOST}/football-team-logo?teamid=${m.away?.id}`,
      homeScore: m.home?.score ?? 0,
      awayScore: m.away?.score ?? 0,
      homeOdd: null,
      drawOdd: null,
      awayOdd: null,
      handicap: null,
      handicapHomeOdd: null,
      handicapAwayOdd: null,
      overUnder: null,
      overOdd: null,
      underOdd: null,
      status: m.status?.finished ? "FT" : (m.status?.started ? "LIVE" : "NS")
    }));
  } catch (error) {
    console.error(`🚨 축구 수집 에러 (${date}):`, error.message);
    return [];
  }
}

// ==========================
// 🏀 기타 종목 수집 (기존 API-Sports 유지)
// ==========================
async function fetchApiSportsMatches(sport, date) {
  const url = `${API_SPORTS_BASE[sport]}/games?date=${date}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": API_SPORTS_KEY,
        "x-apisports-host": API_SPORTS_BASE[sport].replace("https://", "")
      }
    });
    const result = await response.json();
    const games = result.response || [];

    return games.map(g => {
      const homeInfo = g.teams?.home;
      const awayInfo = g.teams?.away;
      const scores = g.scores || {};

      return {
        id: String(g.id),
        sport,
        league: g.league?.name || "기타 리그",
        date: g.date,
        home: homeInfo?.name || "미정",
        away: awayInfo?.name || "미정",
        homeLogo: homeInfo?.logo,
        awayLogo: awayInfo?.logo,
        homeScore: scores.home?.total ?? null,
        awayScore: scores.away?.total ?? null,
        homeOdd: null,
        drawOdd: null,
        awayOdd: null,
        handicap: null,
        handicapHomeOdd: null,
        handicapAwayOdd: null,
        overUnder: null,
        overOdd: null,
        underOdd: null
      };
    });
  } catch (error) {
    console.error(`🚨 ${sport} 수집 에러 (${date}):`, error.message);
    return [];
  }
}

// ==========================
// 🎮 e스포츠 수집 (기존 PandaScore 유지)
// ==========================
async function fetchPandaMatches(date) {
  const url = `https://api.pandascore.co/matches?filter[begin_at]=${date}T00:00:00Z,${date}T23:59:59Z`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${PANDASCORE_KEY}`,
        "Accept": "application/json"
      }
    });
    const matches = await response.json();
    if (!Array.isArray(matches)) return [];

    return matches.map(m => ({
      id: `panda-${m.id}`,
      sport: m.videogame?.slug || "lol",
      league: m.league?.name || "기타",
      date: m.begin_at,
      home: m.opponents?.[0]?.opponent?.name || "TBD",
      away: m.opponents?.[1]?.opponent?.name || "TBD",
      homeLogo: m.opponents?.[0]?.opponent?.image_url,
      awayLogo: m.opponents?.[1]?.opponent?.image_url,
      homeScore: m.results?.[0]?.score ?? null,
      awayScore: m.results?.[1]?.score ?? null,
      homeOdd: null,
      drawOdd: null,
      awayOdd: null,
      handicap: null,
      handicapHomeOdd: null,
      handicapAwayOdd: null,
      overUnder: null,
      overOdd: null,
      underOdd: null
    }));
  } catch (error) {
    console.error(`🚨 e스포츠 수집 에러 (${date}):`, error.message);
    return [];
  }
}

// ==========================
// 📈 배당 데이터 수집 (기존 Odds API 유지)
// ==========================
async function fetchOddsData(sportKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,spreads,totals`;
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error(`🚨 배당 수집 에러 (${sportKey}):`, error.message);
    return [];
  }
}

// ==========================
// 🚀 메인 실행 로직
// ==========================
async function main() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const dates = getTargetDates();
    let allFixtures = [];

    for (const date of dates) {
      console.log(`📅 [${date}] 데이터 수집 중...`);

      // 1. 축구 (수정된 RapidAPI 로직)
      const soccer = await fetchSoccerMatches(date);
      allFixtures = allFixtures.concat(soccer);

      // 2. 다른 종목 (기존 로직)
      const basketball = await fetchApiSportsMatches("basketball", date);
      const baseball = await fetchApiSportsMatches("baseball", date);
      const hockey = await fetchApiSportsMatches("hockey", date);
      const volleyball = await fetchApiSportsMatches("volleyball", date);
      const lol = await fetchPandaMatches(date);

      allFixtures = allFixtures.concat(basketball, baseball, hockey, volleyball, lol);
    }

    // 배당 데이터 매핑 (기존 로직 유지)
    const soccerOdds = await fetchOddsData("soccer_epl"); // 예시로 EPL만
    const basketballOdds = await fetchOddsData("basketball_nba");

    const allOdds = [...(Array.isArray(soccerOdds) ? soccerOdds : []), ...(Array.isArray(basketballOdds) ? basketballOdds : [])];

    // 데이터 병합 및 중복 제거
    const map = new Map();
    allFixtures.forEach(newMatch => {
      const key = `${newMatch.sport}-${newMatch.home}-${newMatch.away}-${newMatch.date?.substring(0, 10)}`;
      
      // 배당 매핑 시도
      const oddInfo = allOdds.find(o => 
        (o.home_team === newMatch.home || o.away_team === newMatch.away)
      );

      if (oddInfo) {
        const h2h = oddInfo.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
        if (h2h) {
          newMatch.homeOdd = h2h.outcomes.find(o => o.name === oddInfo.home_team)?.price || null;
          newMatch.awayOdd = h2h.outcomes.find(o => o.name === oddInfo.away_team)?.price || null;
          newMatch.drawOdd = h2h.outcomes.find(o => o.name === "Draw")?.price || null;
        }
      }

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

    await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(finalAllFixtures, null, 2), "utf-8");
    console.log(`✅ 전체 수집 완료! 총 ${finalAllFixtures.length}건이 ${ALL_FIXTURES_FILE}에 저장되었습니다.`);

  } catch (error) {
    console.error("🚨 실행 중 치명적 오류:", error);
  }
}

main();