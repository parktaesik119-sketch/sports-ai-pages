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

// 깃허브 시크릿에서 키를 가져옵니다.
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const PANDASCORE_KEY = process.env.PANDASCORE_KEY;
const RAPID_KEY = process.env.RAPID_KEY;

// 호스트 설정
const API_SPORTS_BASE = {
  soccer: "https://v3.football.api-sports.io", // football 용어는 API 주소에만 사용 (내부는 soccer)
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};
const RAPID_LOL_HOST = "esportapi1.p.rapidapi.com";
const RAPID_SOCCER_HOST = "free-api-live-football-data.p.rapidapi.com";

/**
 * 주요 축구 리그 ID 목록 (API-SPORTS 기준)
 */
const MAJOR_SOCCER_LEAGUES = [
  39, 40, 140, 141, 135, 136, 78, 79, 61, 62, 307, 244, 106, 233, 103, 71
];

// ==========================
// ⚾ 네이버스포츠 야구 팀코드 매핑
// ==========================
// team_name_map.js(영문→한글 표시용)의 실제 키값과 정확히 일치해야 함.
// SE/SF처럼 코드가 리그 간에 겹치므로 반드시 categoryId별로 분리해서 조회.
const NAVER_TEAM_CODE_MAP = {
  kbo: {
    HH: "Hanwha Eagles",
    HT: "KIA Tigers",
    LG: "LG Twins",
    LT: "Lotte Giants",
    NC: "NC Dinos",
    OB: "Doosan Bears",
    SK: "SSG Landers",
    SS: "Samsung Lions",
    WO: "Kiwoom Heroes",
    KT: "KT Wiz Suwon", // ⚠️ team_name_map.js 키가 "KT Wiz"가 아니라 "KT Wiz Suwon"
  },
  mlb: {
    AN: "Los Angeles Angels",
    AT: "Atlanta Braves",
    AZ: "Arizona Diamondbacks",
    BA: "Baltimore Orioles",
    BO: "Boston Red Sox",
    CC: "Chicago Cubs",
    CI: "Cincinnati Reds",
    CL: "Cleveland Guardians",
    CO: "Colorado Rockies",
    CW: "Chicago White Sox",
    DE: "Detroit Tigers",
    FL: "Miami Marlins",
    HO: "Houston Astros",
    KC: "Kansas City Royals",
    LA: "Los Angeles Dodgers",
    MI: "Milwaukee Brewers",
    MN: "Minnesota Twins",
    MO: "Washington Nationals",
    NM: "New York Mets",
    NY: "New York Yankees",
    OA: "Athletics",
    PH: "Philadelphia Phillies",
    PI: "Pittsburgh Pirates",
    SD: "San Diego Padres",
    SE: "Seattle Mariners",
    SF: "San Francisco Giants",
    SL: "St.Louis Cardinals", // ⚠️ 공백 없음, map 키 그대로
    TB: "Tampa Bay Rays",
    TE: "Texas Rangers",
    TO: "Toronto Blue Jays",
  },
  npb: {
    HI: "Hiroshima Carp",
    HS: "Hanshin Tigers",
    JL: "Chiba Lotte Marines",
    JN: "Chunichi Dragons",
    NH: "Nippon Ham Fighters",
    OX: "Orix Buffaloes",
    RT: "Rakuten Gold. Eagles",
    SE: "Seibu Lions",
    SF: "Fukuoka S. Hawks",
    YA: "Yakult Swallows",
    YK: "Yokohama BayStars",
    YO: "Yomiuri Giants",
  },
};

const NAVER_COUNTRY_BY_CATEGORY = {
  kbo: "South Korea",
  npb: "Japan",
  mlb: "USA",
};

// ==========================
// 🛠 유틸리티 함수
// ==========================

/**
 * 이름 정규화 (공백 제거, 소문자화) - 중복 체크 키 생성용
 */
function normalizeName(name) {

  if (!name) return "";

  return name
    .toLowerCase()
    .replace(/fc|cf|afc|sc|club/g, "")   // 불필요 단어 제거
    .replace(/[^a-z0-9]/g, "")          // 특수문자 제거
    .trim();
}

/**
 * 호출 기간 설정: 현재 기준 -1일 ~ +3일 (총 5일)
 */
function getTargetDates() {
  const dates = [];
  // UTC 기준 현재 시각에서 ms 단위로 날짜 오프셋 계산
  const nowUtc = Date.now();

  for (let i = -1; i <= 3; i++) {
    const target = new Date(nowUtc + i * 24 * 60 * 60 * 1000);
    // KST(+9) 기준 날짜 문자열 추출
    const kstOffset = 9 * 60 * 60 * 1000;
    const kst = new Date(target.getTime() + kstOffset);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
  }

  return [...new Set(dates)];
}

function getDateRange() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  
  // 1. 한국 시간대 포맷터 정의 (서버/로컬 타임존 무력화)
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul"
  });

  const formatKst = (dateObj) => {
    const parts = formatter.formatToParts(dateObj);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
  };

  // 2. 현재 시점을 기반으로 정확하게 -1일과 +3일 시점을 계산
  const fromDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const toDate = new Date(now.getTime() + (72 * 60 * 60 * 1000));

  // 3. toISOString 대신 한국 시간대 포맷터를 거친 문자열 반환
  return {
    from: formatKst(fromDate),
    to: formatKst(toDate)
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
      country: item.league?.country || item.country?.name || "Unknown",
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

async function fetchMajorSoccerLeagues(date) {
  const tasks = MAJOR_SOCCER_LEAGUES.map(async (leagueId) => {

    const d = new Date(date);
    let season = d.getFullYear();

    // 축구 시즌 보정 (유럽 기준)
    // 8월 이전이면 이전 시즌
    if (d.getMonth() < 7) {
    season = season - 1;
    }

  const url = `${API_SPORTS_BASE.soccer}/fixtures?date=${date}&league=${leagueId}&season=${season}`;
    try {
      const res = await fetch(url, { headers: { "x-apisports-key": API_SPORTS_KEY } });
      const data = await res.json();
      if (!data.response) return [];
      return data.response.map(item => ({
        id: String(item.fixture.id),
        sport: "soccer",
        country: item.league.country || "Unknown",
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

async function fetchRapidSoccerRange() {
  const { from, to } = getDateRange();

  const url = `https://${RAPID_SOCCER_HOST}/api/v1/football/fixtures?from=${from}&to=${to}`;

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
      country: item.league.country || "Unknown",
      league: item.league_name,
      date: item.fixture_date,
      home: item.home_team_name,
      away: item.away_team_name,
      homeLogo: item.home_team_logo,
      awayLogo: item.away_team_logo,
      homeScore: item.home_team_score ?? null,
      awayScore: item.away_team_score ?? null
    }));
  } catch (err) {
    return [];
  }
}

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
        id: `rapid-lol-${e.id}`,
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

async function fetchLOLPanda() {
  const dates = getTargetDates();
  // PandaScore는 범위를 지정하여 한 번에 가져옴 (API 횟수 절약)
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
      homeScore: m.results.find(r => r.item_id === m.opponents[0]?.opponent.id)?.score ?? 0,
      awayScore: m.results.find(r => r.item_id === m.opponents[1]?.opponent.id)?.score ?? 0
    }));
  } catch (err) { return []; }
}

/**
 * 네이버스포츠 야구 일정 수집 (KBO: upperCategoryId="kbaseball" / MLB+NPB: upperCategoryId="wbaseball")
 * wbaseball 하나로 MLB+NPB가 categoryId 필드로 구분되어 함께 옵니다.
 */
async function fetchNaverBaseball(upperCategoryId, fromDate, toDate) {
  const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=${upperCategoryId}&fromDate=${fromDate}&toDate=${toDate}&size=500`;

  try {
    const res = await fetch(url, {
      headers: {
        "Referer": "https://m.sports.naver.com/",
        "Origin": "https://m.sports.naver.com",
        "Accept": "application/json, text/plain, */*",
      }
    });
    const data = await res.json();
    const games = data?.result?.games;
    if (!Array.isArray(games)) return [];

    return games
      .filter(g => {
        const map = NAVER_TEAM_CODE_MAP[g.categoryId];
        // 실제 리그 경기만 통과 (편파중계 등 콘텐츠성 항목, 매핑 안 된 All-Star 등 제외)
        return map && g.homeTeamCode && g.awayTeamCode
          && map[g.homeTeamCode] && map[g.awayTeamCode];
      })
      .map(g => {
        const map = NAVER_TEAM_CODE_MAP[g.categoryId];
        // 취소/연기된 경기는 statusCode가 RESULT여도 스코어를 신뢰하지 않음
        const isFinished = g.statusCode === "RESULT" && !g.cancel;
        return {
          id: `naver-${g.categoryId}-${g.gameId}`,
          sport: "baseball",
          country: NAVER_COUNTRY_BY_CATEGORY[g.categoryId] || "Unknown",
          league: g.categoryId.toUpperCase(),
          date: new Date(`${g.gameDateTime}+09:00`).toISOString(), // KST 명시 후 UTC로 통일
          home: map[g.homeTeamCode],
          away: map[g.awayTeamCode],
          homeLogo: g.homeTeamEmblemUrl,
          awayLogo: g.awayTeamEmblemUrl,
          // 진행 전/취소 경기는 null로 둬서 기존 스코어 보존 로직이 정상 작동하게 함
          homeScore: isFinished ? g.homeTeamScore : null,
          awayScore: isFinished ? g.awayTeamScore : null,
        };
      });
  } catch (err) {
    console.error(`fetchNaverBaseball(${upperCategoryId}) 에러:`, err);
    return [];
  }
}

// ==========================
// 🚀 메인 프로세스
// ==========================
async function main() {
  try {
    console.log("🚀 데이터 수집을 시작합니다...");
    const targetDates = getTargetDates(); 
    const sports = ["soccer", "basketball", "baseball", "hockey", "volleyball"];
    const scheduleTasks = [];

    targetDates.forEach(date => {
      sports.forEach(sport => {
        scheduleTasks.push(fetchApiSports(sport, date)); // 5일치 각 날짜별 모든 종목 호출
      });
      scheduleTasks.push(fetchLckRapid(date));
    });

// ✅ 날짜 루프 밖에서 1번만 호출
scheduleTasks.push(fetchRapidSoccerRange());
    
    // LoL 전용 및 배당 호출
    scheduleTasks.push(fetchLOLPanda());

    // ✅ 네이버스포츠 야구 (KBO / MLB+NPB) — api-sports 야구 호출 이후에 push하여
    //    혹시 모를 키 충돌 시 네이버 데이터가 우선 적용되도록 함
    const naverFrom = targetDates[0];
    const naverTo = targetDates[targetDates.length - 1];
    scheduleTasks.push(fetchNaverBaseball("kbaseball", naverFrom, naverTo)); // KBO
    scheduleTasks.push(fetchNaverBaseball("wbaseball", naverFrom, naverTo)); // MLB + NPB

    const rawResults = await Promise.all(scheduleTasks);

    const mergedData = rawResults.flat();

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // 기존 all-fixtures.json 로드
    const map = new Map();
    let existingFixtures = [];
    try { 
      const content = await fs.readFile(ALL_FIXTURES_FILE, "utf-8");
      existingFixtures = JSON.parse(content || "[]");
    } catch (e) {
      console.log("ℹ️ 기존 all-fixtures.json이 없습니다. 새로 생성합니다.");
    }

    // 중복 체크 및 업데이트 로직 (Key: 날짜_홈팀_원정팀)
    existingFixtures.forEach(m => {
      const dKey = new Date(m.date).toISOString().split("T")[0];
      const key = `${dKey}_${normalizeName(m.home)}_${normalizeName(m.away)}`;
      map.set(key, m);
    });

    // 3) 병합 처리
    mergedData.forEach(newMatch => {
      if (!newMatch.date) return;
      const dKey = new Date(newMatch.date).toISOString().split("T")[0];
      const key = `${dKey}_${normalizeName(newMatch.home)}_${normalizeName(newMatch.away)}`;

      if (map.has(key)) {
        const oldMatch = map.get(key);
        
        // 스코어 유효성 검사 함수 (null, undefined, 공백문자 방지)
        const isValidScore = (score) => score !== null && score !== undefined && String(score).trim() !== '';

        map.set(key, {
          ...oldMatch,
          ...newMatch,
          // 새 데이터에 진짜 점수가 존재할 때만 업데이트하고, 없을 경우 기존(과거 수집된) 점수를 보존
          homeScore: isValidScore(newMatch.homeScore) ? newMatch.homeScore : oldMatch.homeScore,
          awayScore: isValidScore(newMatch.awayScore) ? newMatch.awayScore : oldMatch.awayScore,
          
          // 배당 정보 안전 가드 장치
          homeOdd: (newMatch.homeOdd && newMatch.homeOdd !== "N/A" && newMatch.homeOdd !== "") ? newMatch.homeOdd : oldMatch.homeOdd,
          awayOdd: (newMatch.awayOdd && newMatch.awayOdd !== "N/A" && newMatch.awayOdd !== "") ? newMatch.awayOdd : oldMatch.awayOdd,
          drawOdd: (newMatch.drawOdd && newMatch.drawOdd !== "N/A" && newMatch.drawOdd !== "") ? newMatch.drawOdd : oldMatch.drawOdd
        });
      } else {
        map.set(key, newMatch);
      }
    });

    const finalAllFixtures = Array.from(map.values());
    finalAllFixtures.sort((a, b) => new Date(a.date) - new Date(b.date));

    const beforeCount = existingFixtures.length;
    const afterCount = finalAllFixtures.length;

    console.log(`기존: ${beforeCount}건`);
    console.log(`현재: ${afterCount}건`);
    console.log(`추가됨: ${afterCount - beforeCount}건`);

    // 파일 저장
    await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(finalAllFixtures, null, 2));

    // 한국 시간(KST) 기준으로 날짜 문자열 생성 (ISO 8601 형식)
    const nowKst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const todayKst = `${nowKst.getFullYear()}-${String(nowKst.getMonth() + 1).padStart(2, '0')}-${String(nowKst.getDate()).padStart(2, '0')}`;

    await fs.writeFile(path.join(OUTPUT_DIR, `${todayKst}.json`), JSON.stringify(mergedData, null, 2));

    console.log(`✅ 업데이트 완료: 총 ${finalAllFixtures.length}건의 데이터가 누적 저장되었습니다.`);
  } catch (err) {
    console.error("❌ 통합 프로세스 에러:", err.stack);
  }
}

main();