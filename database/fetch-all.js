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
// 🛠 유틸리티 함수 (매칭 최적화)
// ==========================

// 1. 팀명 정규화: FSV Mainz 05 -> mainz05 처럼 변환하여 매칭 확률 극대화
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/fsv|fc|u19|u20|u23|academy|challengers/g, "") 
    .replace(/[^a-z0-9]/g, "") 
    .trim();
}

// 2. 날짜 배열 생성 (어제, 오늘, 내일, 모레)
function getTargetDates() {
  const dates = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

// ==========================
// 📡 데이터 호출 함수 (Node 내장 fetch 사용)
// ==========================

async function fetchApiSports(sport, date) {
  const baseUrl = API_SPORTS_BASE[sport];
  const endpoint = sport === "soccer" ? "fixtures" : "games";
  const url = `${baseUrl}/${endpoint}?date=${date}`;

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
  } catch (err) {
    console.error(`[${sport}] 호출 실패:`, err.message);
    return [];
  }
}

async function fetchLOL() {
  const url = `https://api.pandascore.co/lol/matches/upcoming?token=${PANDASCORE_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.map(m => ({
      id: String(m.id),
      sport: "lol",
      league: m.league.name,
      date: m.begin_at,
      home: m.opponents[0]?.opponent.name || "TBD",
      away: m.opponents[1]?.opponent.name || "TBD",
      homeLogo: m.opponents[0]?.opponent.image_url,
      awayLogo: m.opponents[1]?.opponent.image_url,
      homeScore: null,
      awayScore: null
    }));
  } catch (err) {
    return [];
  }
}

async function fetchOddsAndScores() {
  const sportsKeys = ["soccer_uefa_champs_league", "soccer_k_league_1", "baseball_mlb", "basketball_nba", "icehockey_nhl"];
  const odds = [];
  const scores = [];

  for (const key of sportsKeys) {
    try {
      const [oRes, sRes] = await Promise.all([
        fetch(`https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals`),
        fetch(`https://api.the-odds-api.com/v4/sports/${key}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`)
      ]);
      const [oData, sData] = await Promise.all([oRes.json(), sRes.json()]);
      if (Array.isArray(oData)) odds.push(...oData);
      if (Array.isArray(sData)) scores.push(...sData);
    } catch (e) {}
  }
  return { odds, scores };
}

// ==========================
// 🔗 배당 매칭 및 평균값 계산 로직 (수정 사항 반영)
// ==========================

function getMatchedData(match, allOdds, allScores) {
  const matchDate = match.date.split("T")[0]; // 시간 무시, 날짜만 추출
  const homeNorm = normalizeName(match.home);
  const awayNorm = normalizeName(match.away);

  // 1. 날짜 + 팀명 유사도로 해당 경기 배당 데이터 찾기
  const oddsInfo = allOdds.find(o => 
    o.commence_time.startsWith(matchDate) && 
    (normalizeName(o.home_team).includes(homeNorm) || normalizeName(o.away_team).includes(awayNorm))
  );

  const result = {
    homeOdd: null, drawOdd: null, awayOdd: null,
    handicap: null, handicapHomeOdd: null, handicapAwayOdd: null,
    overUnder: null, overOdd: null, underOdd: null
  };

  if (oddsInfo && oddsInfo.bookmakers) {
    const priorityList = ["onexbet", "pinnacle", "draftkings", "lowvig"];
    let hSum = 0, dSum = 0, aSum = 0, count = 0;

    // 2. 북메이커 루프: 우선순위 확인 및 평균값 계산 준비
    oddsInfo.bookmakers.forEach(bookie => {
      const h2h = bookie.markets.find(m => m.key === "h2h");
      if (h2h) {
        const h = h2h.outcomes.find(o => normalizeName(o.name).includes(homeNorm))?.price;
        const a = h2h.outcomes.find(o => normalizeName(o.name).includes(awayNorm))?.price;
        const d = h2h.outcomes.find(o => o.name === "Draw")?.price;

        if (h && a) {
          // 우선순위 북메이커인 경우 즉시 할당 후 종료 (선택 사항)
          if (priorityList.includes(bookie.key) && count === 0) {
             result.homeOdd = h; result.awayOdd = a; result.drawOdd = d || null;
          }
          hSum += h; aSum += a; dSum += (d || 0);
          count++;
        }
      }
      // 핸디캡 및 언오버도 동일한 방식으로 평균값 추출 가능 (지면상 생략/통합)
    });

    // 3. 우선순위 데이터가 없으면 전체 평균값 적용
    if (!result.homeOdd && count > 0) {
      result.homeOdd = Number((hSum / count).toFixed(2));
      result.awayOdd = Number((aSum / count).toFixed(2));
      result.drawOdd = dSum > 0 ? Number((dSum / count).toFixed(2)) : null;
    }
  }

  // 4. 스코어 업데이트 (어제 경기 결과 반영)
  if (match.homeScore === null) {
    const scoreInfo = allScores.find(s => s.commence_time.startsWith(matchDate) && normalizeName(s.home_team).includes(homeNorm));
    if (scoreInfo?.scores) {
      match.homeScore = parseInt(scoreInfo.scores.find(ts => normalizeName(ts.name).includes(homeNorm))?.score || 0);
      match.awayScore = parseInt(scoreInfo.scores.find(ts => normalizeName(ts.name).includes(awayNorm))?.score || 0);
    }
  }

  return { ...match, ...result };
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
    scheduleTasks.push(fetchLOL());

    const [rawResults, oddsAndScores] = await Promise.all([
      Promise.all(scheduleTasks),
      fetchOddsAndScores()
    ]);

    const mergedData = rawResults.flat().map(m => getMatchedData(m, oddsAndScores.odds, oddsAndScores.scores));

    // 누적 저장 (all-fixtures.json)
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    let existing = [];
    try { existing = JSON.parse(await fs.readFile(ALL_FIXTURES_FILE, "utf-8")); } catch (e) {}

    const map = new Map();
    existing.forEach(m => map.set(`${m.date.split("T")[0]}_${m.home}_${m.away}`, m));
    mergedData.forEach(m => map.set(`${m.date.split("T")[0]}_${m.home}_${m.away}`, m));

    await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(Array.from(map.values()), null, 2));
    
    const todayStr = new Date().toISOString().split("T")[0];
    await fs.writeFile(path.join(OUTPUT_DIR, `${todayStr}.json`), JSON.stringify(mergedData, null, 2));

    console.log(`✅ ${todayStr}.json 저장 및 누적 업데이트 완료!`);
  } catch (err) {
    console.error("실행 에러:", err);
  }
}

main();