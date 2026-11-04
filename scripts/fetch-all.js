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
const HIGHLIGHTLY_KEY = process.env.HIGHLIGHTLY_KEY;

// 호스트 설정
// ⚠️ soccer는 2026-08부터 api-sports 대신 fotmob으로 완전히 이관함.
//    (api-sports 무료 계정이 GitHub Actions IP를 반복적으로 정지시켜서 —
//    fotmob은 키/인증이 아예 필요 없고 IP 차단 이력도 없어 훨씬 안정적)
const API_SPORTS_BASE = {
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};
const RAPID_LOL_HOST = "esportapi1.p.rapidapi.com";
// ⚠️ RAPID_SOCCER_HOST(축구 보조, free-api-live-football-data)는 2026-08 제거함.
// fotmob으로 축구를 완전히 대체한 뒤 확인해보니, 이 API의 엔드포인트
// (/api/v1/football/fixtures)는 이미 존재하지 않는 상태(404)라 매번 조용히
// 빈 배열만 반환하고 있었음(catch로 삼켜져서 티가 안 났음) — 실질 기여 0건,
// 순수 낭비 호출이었음이 실사용 데이터로 확인됨.

// ─────────────────────────────────────────────
// fotmob 국가/협회 코드(ccode) → 영문 국가명 매핑
// ─────────────────────────────────────────────
let FOTMOB_COUNTRY_MAP = {};
async function loadFotmobCountryMap() {
  try {
    const raw = await fs.readFile(path.join(__dirname, "fotmob-country-map.json"), "utf-8");
    const parsed = JSON.parse(raw);
    delete parsed._설명;
    FOTMOB_COUNTRY_MAP = parsed;
  } catch (err) {
    console.error("⚠️ fotmob-country-map.json 로드 실패, 국가명이 코드로만 표시됩니다:", err.message);
    FOTMOB_COUNTRY_MAP = {};
  }
}
const unmappedCountryCodes = new Set(); // 실행 끝나고 한 번에 로그로 보여주기 위한 수집용

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
 * UTC ISO 문자열 → KST(Asia/Seoul) 기준 'YYYY-MM-DD' 날짜 문자열
 * 외부 API가 옵션(예: fotmob의 includeNextDayLateNight)으로 요청 범위 밖
 * 날짜의 경기까지 끼워 보낼 때, 응답을 KST 기준으로 다시 걸러내기 위한 유틸.
 */
function toKstDateStr(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(d.getTime() + kstOffset);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * 호출 기간 설정: 현재 기준 -1일 ~ +2일 (총 4일)
 */
function getTargetDates() {
  const dates = [];
  // UTC 기준 현재 시각에서 ms 단위로 날짜 오프셋 계산
  const nowUtc = Date.now();

  for (let i = -1; i <= 2; i++) {
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

/**
 * ⚾🏒 야구/하키 전용 호출 기간: 현재 기준 -1일 ~ +1일 (총 3일)
 * 야구(KBO/MLB/NPB/CPBL)는 같은 두 팀이 연전을 붙는 게 기본 포맷이고,
 * 하키(NHL/KHL)도 백투백 일정에서 드물게 같은 팀과 연속 편성되는 경우가 있어서,
 * 전날 경기 결과가 다음 경기 분석에 반영되려면 D+2까지 미리 긁어오면 안 되고
 * D+1까지만 수집해야 함. (다른 종목들은 기존 getTargetDates()의 D-1~D+2 범위를 그대로 사용)
 */
function getShortRangeTargetDates() {
  const dates = [];
  const nowUtc = Date.now();

  for (let i = -1; i <= 1; i++) {
    const target = new Date(nowUtc + i * 24 * 60 * 60 * 1000);
    const kstOffset = 9 * 60 * 60 * 1000;
    const kst = new Date(target.getTime() + kstOffset);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
  }

  return [...new Set(dates)];
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

// ⚽ 축구 전용 — fotmob 경기 목록 API (인증 불필요, IP 차단 이력 없음, 검증 완료 2026-08)
// api-sports fixtures를 완전히 대체한다. 국가명(코드→풀네임)/팀 로고(팀ID로 URL 조립)만
// 보정하면 기존 스키마와 100% 동일하게 맞출 수 있음(실사용 검증 완료).
async function fetchFotmobSoccerFixtures(dateStr /* YYYY-MM-DD */) {
  const d = dateStr.replace(/-/g, "");
  const url = `https://www.fotmob.com/api/data/matches?date=${d}&timezone=Asia%2FSeoul&ccode3=KOR&includeNextDayLateNight=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const leagues = data.leagues || [];

    const results = [];
    for (const lg of leagues) {
      const countryName = FOTMOB_COUNTRY_MAP[lg.ccode];
      if (!countryName && lg.ccode) unmappedCountryCodes.add(lg.ccode);

      for (const m of (lg.matches || [])) {
        if (!m.home?.id || !m.away?.id) continue; // 팀 ID 없는 항목(플레이스홀더 등) 방어
        results.push({
          id: `fotmob-${m.id}`,
          sport: "soccer",
          country: countryName || lg.ccode || "Unknown",
          league: lg.name,
          date: m.status?.utcTime || null,
          home: m.home.name,
          away: m.away.name,
          homeLogo: `https://images.fotmob.com/image_resources/logo/teamlogo/${m.home.id}.png`,
          awayLogo: `https://images.fotmob.com/image_resources/logo/teamlogo/${m.away.id}.png`,
          homeScore: m.status?.finished ? (m.home.score ?? null) : null,
          awayScore: m.status?.finished ? (m.away.score ?? null) : null,
        });
      }
    }
    // includeNextDayLateNight=true 옵션 때문에 요청한 날짜(dateStr) 다음날 새벽 경기까지
    // 응답에 섞여 들어올 수 있다. utcTime을 KST 날짜로 환산해 요청한 날짜와 정확히
    // 일치하는 것만 남긴다 — 분석 시점 기준 너무 먼 미래 경기가 섞이는 것을 막기 위함.
    // (해당 다음날 경기는 사라지는 게 아니라, 그 날짜가 실제로 D+2 범위에 들어오는
    //  다음 실행 때 정상적으로 다시 수집된다.)
    return results.filter(m => m.date && toKstDateStr(m.date) === dateStr);
  } catch (err) {
    console.error(`❌ fotmob 축구 일정 조회 실패 (${dateStr}):`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// ⚾ 야구 — 네이버스포츠 (KBO / MLB+NPB). api-sports 대체 (2026-08).
// CPBL은 네이버에 없어서 커버 안 됨 — 별도 소스 필요(추후 작업).
// ─────────────────────────────────────────────

// 네이버 팀코드 → team_name_map.js가 쓰는 영문 표준명 (기존 조사 결과 그대로 재사용)
const NAVER_TEAM_CODE_MAP = {
  kbo: {
    HH: "Hanwha Eagles", HT: "KIA Tigers", LG: "LG Twins", LT: "Lotte Giants",
    NC: "NC Dinos", OB: "Doosan Bears", SK: "SSG Landers", SS: "Samsung Lions",
    WO: "Kiwoom Heroes", KT: "KT Wiz Suwon", // ⚠️ team_name_map.js 키가 "KT Wiz"가 아니라 "KT Wiz Suwon"
  },
  mlb: {
    AN: "Los Angeles Angels", AT: "Atlanta Braves", AZ: "Arizona Diamondbacks",
    BA: "Baltimore Orioles", BO: "Boston Red Sox", CC: "Chicago Cubs",
    CI: "Cincinnati Reds", CL: "Cleveland Guardians", CO: "Colorado Rockies",
    CW: "Chicago White Sox", DE: "Detroit Tigers", FL: "Miami Marlins",
    HO: "Houston Astros", KC: "Kansas City Royals", LA: "Los Angeles Dodgers",
    MI: "Milwaukee Brewers", MN: "Minnesota Twins", MO: "Washington Nationals",
    NM: "New York Mets", NY: "New York Yankees", OA: "Athletics",
    PH: "Philadelphia Phillies", PI: "Pittsburgh Pirates", SD: "San Diego Padres",
    SE: "Seattle Mariners", SF: "San Francisco Giants", SL: "St.Louis Cardinals",
    TB: "Tampa Bay Rays", TE: "Texas Rangers", TO: "Toronto Blue Jays",
  },
  npb: {
    HI: "Hiroshima Carp", HS: "Hanshin Tigers", JL: "Chiba Lotte Marines",
    JN: "Chunichi Dragons", NH: "Nippon Ham Fighters", OX: "Orix Buffaloes",
    RT: "Rakuten Gold. Eagles", SE: "Seibu Lions", SF: "Fukuoka S. Hawks",
    YA: "Yakult Swallows", YK: "Yokohama BayStars", YO: "Yomiuri Giants",
  },
};
const NAVER_COUNTRY_BY_CATEGORY = { kbo: "South Korea", npb: "Japan", mlb: "USA" };

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
        // 실제 리그 경기만 통과 (편파중계 등 콘텐츠성 항목, 매핑 안 된 팀 제외)
        return map && g.homeTeamCode && g.awayTeamCode
          && map[g.homeTeamCode] && map[g.awayTeamCode];
      })
      .map(g => {
        const map = NAVER_TEAM_CODE_MAP[g.categoryId];
        // 아직 시작 안 한 경기의 스코어 0은 "진짜 0"이 아니라 "미정"이므로 null로 둔다.
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
          homeScore: isFinished ? g.homeTeamScore : null,
          awayScore: isFinished ? g.awayTeamScore : null,
        };
      });
  } catch (err) {
    console.error(`❌ fetchNaverBaseball(${upperCategoryId}) 에러:`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 🏀 농구 — 네이버스포츠 (NBA / KBL / WKBL). api-sports 대체 (2026-08).
// 세 리그가 superCategoryId=basketball 하나로 다 같이 온다(야구가 kbaseball/
// wbaseball로 나뉘던 것과 다름) — categoryId로 구분해서 걸러낸다.
// ─────────────────────────────────────────────

const NAVER_NBA_CODE_MAP = {
  BOS: "Boston Celtics", ATL: "Atlanta Hawks", BKN: "Brooklyn Nets", CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets",
  DET: "Detroit Pistons", GS: "Golden State Warriors", HOU: "Houston Rockets", MIA: "Miami Heat",
  IND: "Indiana Pacers", LAC: "LA Clippers", LAL: "Los Angeles Lakers", MIN: "Minnesota Timberwolves",
  NO: "New Orleans Pelicans", NY: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers", PHO: "Phoenix Suns", POR: "Portland Trail Blazers", SA: "San Antonio Spurs",
  SAC: "Sacramento Kings", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards",
  MEM: "Memphis Grizzlies", MIL: "Milwaukee Bucks",
};
const NAVER_KBL_CODE_MAP = {
  "55": "SK Knights", "50": "Changwon LG", "10": "Ulsan Hyundai Mobis", "06": "Suwon KT",
  "64": "Daegu KOGAS", "70": "Anyang JungKwanJang", "16": "Wonju DB", "66": "Goyang Sono",
  "60": "KCC Egis", "35": "Samsung Thunders",
};
const NAVER_WKBL_CODE_MAP = {
  "05": "Woori Bank WON", "07": "Shinhan Bank S-Birds", "01": "KB Stars",
  "03": "Samsung Blue Minx", "09": "Hana Bank", "11": "BNK Sum",
};

const NAVER_BASKETBALL_CODE_MAP = { nba: NAVER_NBA_CODE_MAP, kbl: NAVER_KBL_CODE_MAP, wkbl: NAVER_WKBL_CODE_MAP };
const NAVER_BASKETBALL_COUNTRY = { nba: "USA", kbl: "South Korea", wkbl: "South Korea" };
const NAVER_BASKETBALL_LEAGUE_NAME = { nba: "NBA", kbl: "KBL", wkbl: "WKBL W" }; // WKBL은 여자부 표시로 W를 붙임

async function fetchNaverBasketball(fromDate, toDate) {
  const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cconference%2CmanualRelayUrl&superCategoryId=basketball&fromDate=${fromDate}&toDate=${toDate}&size=500`;

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
        const map = NAVER_BASKETBALL_CODE_MAP[g.categoryId];
        // nba/kbl/wkbl만 통과 (basketballetc 같은 콘텐츠성 항목, 매핑 안 된 팀 제외)
        return map && g.homeTeamCode && g.awayTeamCode
          && map[g.homeTeamCode] && map[g.awayTeamCode];
      })
      .map(g => {
        const map = NAVER_BASKETBALL_CODE_MAP[g.categoryId];
        const isWomen = g.categoryId === "wkbl";
        const suffix = isWomen ? " W" : "";
        const isFinished = g.statusCode === "RESULT" && !g.cancel;
        return {
          id: `naver-${g.categoryId}-${g.gameId}`,
          sport: "basketball",
          country: NAVER_BASKETBALL_COUNTRY[g.categoryId] || "Unknown",
          league: NAVER_BASKETBALL_LEAGUE_NAME[g.categoryId] || g.categoryId.toUpperCase(),
          date: new Date(`${g.gameDateTime}+09:00`).toISOString(), // KST 명시 후 UTC로 통일
          home: `${map[g.homeTeamCode]}${suffix}`,
          away: `${map[g.awayTeamCode]}${suffix}`,
          homeLogo: g.homeTeamEmblemUrl,
          awayLogo: g.awayTeamEmblemUrl,
          homeScore: isFinished ? g.homeTeamScore : null,
          awayScore: isFinished ? g.awayTeamScore : null,
        };
      });
  } catch (err) {
    console.error(`❌ fetchNaverBasketball 에러:`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 🏐 배구 — 네이버스포츠 (V리그 남자부 KOVO / 여자부 WKOVO). api-sports 대체 (2026-08).
// 농구와 달리 남녀부가 categoryId로 분리 호출된다(응답이 같이 안 옴) — 각 1번씩 호출.
// 국제 대회(FIVB 등)는 네이버가 지원 안 해서 커버 범위 밖 — 국내 V리그만 해당.
// ─────────────────────────────────────────────

const NAVER_KOVO_CODE_MAP = {
  "1001": "Korean Air Jumbos", "1002": "Samsung Fire Bluefangs", "1004": "KB Insurance Stars",
  "1005": "Hyundai Capital Skywalkers", "1006": "KEPCO Vixtorm", "1008": "OK Savings Bank OKman",
  "1009": "Woori Card WON",
};
const NAVER_WKOVO_CODE_MAP = {
  "2001": "Hyundai E&C Hillstate", "2002": "Korea Expressway Hi-pass", "2003": "Jungkwanjang Red Sparks",
  "2004": "Heungkuk Life Pink Spiders", "2005": "GS Caltex Seoul KIXX", "2006": "IBK Altos",
  "2007": "SOOP Supers", // ⚠️ 구 페퍼저축은행, 2026-06-02부로 SOOP에 인수되며 개명
};
const NAVER_VOLLEYBALL_CODE_MAP = { kovo: NAVER_KOVO_CODE_MAP, wkovo: NAVER_WKOVO_CODE_MAP };
const NAVER_VOLLEYBALL_LEAGUE_NAME = { kovo: "KOVO", wkovo: "WKOVO W" };

async function fetchNaverVolleyball(categoryId, fromDate, toDate) {
  const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cround%2CgroupName%2CneutralGround%2CmanualRelayUrl&superCategoryId=volleyball&categoryId=${categoryId}&fromDate=${fromDate}&toDate=${toDate}&roundCodes=&size=500`;

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

    const map = NAVER_VOLLEYBALL_CODE_MAP[categoryId];
    const isWomen = categoryId === "wkovo";
    const suffix = isWomen ? " W" : "";

    return games
      .filter(g => g.homeTeamCode && g.awayTeamCode && map[g.homeTeamCode] && map[g.awayTeamCode])
      .map(g => {
        const isFinished = g.statusCode === "RESULT" && !g.cancel;
        return {
          id: `naver-${categoryId}-${g.gameId}`,
          sport: "volleyball",
          country: "South Korea",
          league: NAVER_VOLLEYBALL_LEAGUE_NAME[categoryId] || categoryId.toUpperCase(),
          date: new Date(`${g.gameDateTime}+09:00`).toISOString(), // KST 명시 후 UTC로 통일
          home: `${map[g.homeTeamCode]}${suffix}`,
          away: `${map[g.awayTeamCode]}${suffix}`,
          homeLogo: g.homeTeamEmblemUrl,
          awayLogo: g.awayTeamEmblemUrl,
          homeScore: isFinished ? g.homeTeamScore : null,
          awayScore: isFinished ? g.awayTeamScore : null,
        };
      });
  } catch (err) {
    console.error(`❌ fetchNaverVolleyball(${categoryId}) 에러:`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 🏒 하키 — Highlightly (NHL / KHL). api-sports 대체 (2026-08).
// 리그 id는 /hockey/leagues?leagueName=... 로 미리 확인해둔 고정값 (실사용 검증 완료).
// KHL은 서방 데이터 생태계에서 거의 유일하게 무료로 제대로 지원하는 곳이었음
// (ESPN·api-sports·Sofascore 다 확인해봤지만 안 됐음 — 2026-08 조사).
// ─────────────────────────────────────────────

const HIGHLIGHTLY_HOCKEY_LEAGUES = { NHL: 49291, KHL: 30569 };

async function fetchHighlightlyHockey(date) {
  const results = [];

  for (const [leagueName, leagueId] of Object.entries(HIGHLIGHTLY_HOCKEY_LEAGUES)) {
    try {
      const url = `https://sports.highlightly.net/hockey/matches?leagueId=${leagueId}&date=${date}`;
      const res = await fetch(url, {
        headers: { "x-rapidapi-key": HIGHLIGHTLY_KEY },
      });
      const data = await res.json();
      const matches = data?.data;
      if (!Array.isArray(matches)) continue;

      for (const m of matches) {
        if (!m.homeTeam?.name || !m.awayTeam?.name) continue;

        // description이 "Finished"/"Finished after over time" 등으로 오므로 접두어만 확인
        const isFinished = /^Finished/i.test(m.state?.description || "");
        const [homeScoreRaw, awayScoreRaw] = (m.state?.score?.current || "").split("-").map(s => s.trim());
        const homeScore = Number(homeScoreRaw);
        const awayScore = Number(awayScoreRaw);

        results.push({
          id: `highlightly-hockey-${m.id}`,
          sport: "hockey",
          country: m.country?.name || "Unknown",
          league: leagueName,
          date: m.date,
          home: m.homeTeam.name,
          away: m.awayTeam.name,
          homeLogo: m.homeTeam.logo,
          awayLogo: m.awayTeam.logo,
          homeScore: isFinished && Number.isFinite(homeScore) ? homeScore : null,
          awayScore: isFinished && Number.isFinite(awayScore) ? awayScore : null,
        });
      }
    } catch (err) {
      console.error(`❌ fetchHighlightlyHockey(${leagueName}, ${date}) 에러:`, err.message);
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// ⚾ CPBL(대만 프로야구) — FlashScore. 네이버가 커버 안 하는 리그라 보강용으로 사용.
// KBO/MLB/NPB는 그대로 네이버(fetchNaverBaseball) 담당, CPBL만 여기서 따로 채운다.
// sport_id=6(Baseball)로 그날 전체 야구 리그가 다 오므로, 그중 대만만 걸러낸다.
// ─────────────────────────────────────────────

const FLASHSCORE_HOST = "flashscore4.p.rapidapi.com";

async function fetchFlashscoreCPBL(date) {
  try {
    const url = `https://${FLASHSCORE_HOST}/api/flashscore/v2/matches/list-by-date?sport_id=6&date=${date}&timezone=Asia%2FSeoul`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": RAPID_KEY,
        "x-rapidapi-host": FLASHSCORE_HOST,
      },
    });
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const cpbl = data.find(t => /taiwan/i.test(t.country_name || "") && /cpbl/i.test(t.name || ""));
    if (!cpbl) return [];

    return (cpbl.matches || [])
      .filter(m => m.home_team?.name && m.away_team?.name)
      .map(m => ({
        id: `flashscore-cpbl-${m.match_id}`,
        sport: "baseball",
        country: "Taiwan",
        league: "CPBL",
        date: new Date(m.timestamp * 1000).toISOString(),
        home: m.home_team.name,
        away: m.away_team.name,
        homeLogo: m.home_team.small_image_path,
        awayLogo: m.away_team.small_image_path,
        homeScore: m.match_status?.is_finished ? m.scores?.home ?? null : null,
        awayScore: m.match_status?.is_finished ? m.scores?.away ?? null : null,
      }));
  } catch (err) {
    console.error(`❌ fetchFlashscoreCPBL(${date}) 에러:`, err.message);
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

  // ⚠️ dates[]는 KST 기준 날짜 문자열이다. '+09:00' 오프셋 표기는 URL 쿼리스트링에서
  //    '+' 문자가 공백으로 해석되어 날짜가 깨지는 문제가 있으므로,
  //    KST 시각을 UTC로 직접 환산해 'Z' 형식으로만 보낸다.
  function kstBoundaryToUtcIso(dateStr, h, m, s) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const utcMs = Date.UTC(y, mo - 1, d, h, m, s) - 9 * 60 * 60 * 1000; // KST = UTC+9
    return new Date(utcMs).toISOString();
  }
  const fromKst = kstBoundaryToUtcIso(dates[0], 0, 0, 0);
  const toKst = kstBoundaryToUtcIso(dates[dates.length - 1], 23, 59, 59);

  const allMatches = [];
  const perPage = 100; // PandaScore 최대 페이지 크기
  let page = 1;

  try {
    while (true) {
      // ⚠️ '/matches'는 LoL뿐 아니라 Dota2, CS:GO, 오버워치 등 모든 게임이 섞여서 오는
      //    통합 엔드포인트다. LoL만 정확히 가져오려면 '/lol/matches'를 사용해야 한다.
      const url =
        `https://api.pandascore.co/lol/matches` +
        `?range[begin_at]=${fromKst},${toKst}` +
        `&sort=begin_at` +
        `&page[size]=${perPage}` +
        `&page[number]=${page}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${PANDASCORE_KEY}` } });
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) break;

      allMatches.push(...data);

      // 받아온 개수가 perPage보다 적으면 마지막 페이지이므로 중단.
      // ⚠️ 기존 코드는 page[size]/page[number]를 아예 지정하지 않아
      //    기본값인 50건에서 잘려나가는 문제가 있었다.
      if (data.length < perPage) break;
      page++;
    }
  } catch (err) {
    return allMatches.map(mapPandaMatch);
  }

  return allMatches.map(mapPandaMatch);
}

function mapPandaMatch(m) {
  return {
    id: `panda-${m.id}`,
    sport: "lol",
    league: m.league?.name,
    date: m.begin_at,
    home: m.opponents?.[0]?.opponent?.name || "TBD",
    away: m.opponents?.[1]?.opponent?.name || "TBD",
    homeLogo: m.opponents?.[0]?.opponent?.image_url,
    awayLogo: m.opponents?.[1]?.opponent?.image_url,
    // ⚠️ PandaScore results 배열의 팀 식별 필드는 item_id가 아니라 team_id다.
    homeScore: m.results?.find(r => r.team_id === m.opponents?.[0]?.opponent?.id)?.score ?? 0,
    awayScore: m.results?.find(r => r.team_id === m.opponents?.[1]?.opponent?.id)?.score ?? 0
  };
}

// ==========================
// 🚀 메인 프로세스
// ==========================
async function main() {
  try {
    console.log("🚀 데이터 수집을 시작합니다...");
    await loadFotmobCountryMap();

    const targetDates = getTargetDates(); 
    // ⚠️ soccer는 아래 sports 배열에서 빠짐 — fotmob 전용 루프에서 별도 처리
    // ⚠️ baseball도 아래 sports 배열에서 빠짐 — 네이버 전용 루프에서 별도 처리 (2026-08)
    // ⚠️ basketball도 아래 sports 배열에서 빠짐 — 네이버 전용 루프에서 별도 처리 (2026-08)
    // ⚠️ volleyball도 아래 sports 배열에서 빠짐 — 네이버 전용 루프에서 별도 처리 (2026-08)
    // ⚠️ hockey도 아래 sports 배열에서 빠짐 — Highlightly 전용 루프에서 별도 처리 (2026-08)
    const sports = [];
    const scheduleTasks = [];

    targetDates.forEach(date => {
      sports.forEach(sport => {
        scheduleTasks.push(fetchApiSports(sport, date));
      });
      scheduleTasks.push(fetchLckRapid(date));
      // ⚽ 축구: fotmob으로 날짜별 호출 (api-sports 대체, 2026-08)
      scheduleTasks.push(fetchFotmobSoccerFixtures(date));
    });


    // ⚾🏒 야구 + 하키 — 다른 종목과 별도로 D-1~D+1 범위만 사용
    // (연전/백투백으로 같은 두 팀이 연속 편성되는 경우가 있어서, 전날 결과가
    //  반영되기 전인 D+2 일정까지 미리 긁어오면 분석 시점에 결과 누락이 생길 수 있음)
    const shortRangeDates = getShortRangeTargetDates();
    const shortRangeFrom = shortRangeDates[0];
    const shortRangeTo = shortRangeDates[shortRangeDates.length - 1];
    scheduleTasks.push(fetchNaverBaseball("kbaseball", shortRangeFrom, shortRangeTo)); // KBO
    scheduleTasks.push(fetchNaverBaseball("wbaseball", shortRangeFrom, shortRangeTo)); // MLB + NPB

    // ⚾ CPBL / 🏒 하키(NHL+KHL): 날짜별 호출 — 야구와 동일하게 D-1~D+1 범위만 사용
    shortRangeDates.forEach(date => {
      scheduleTasks.push(fetchFlashscoreCPBL(date));
      scheduleTasks.push(fetchHighlightlyHockey(date));
    });

    // 🏀🏐 네이버스포츠(농구/배구)가 공유하는 날짜 범위 — api-sports 대체, 범위 방식으로 호출
    const naverRangeFrom = targetDates[0];
    const naverRangeTo = targetDates[targetDates.length - 1];

    // 🏀 농구: 네이버스포츠 (NBA / KBL / WKBL) — api-sports 대체, 범위 방식으로 1번만 호출
    scheduleTasks.push(fetchNaverBasketball(naverRangeFrom, naverRangeTo));

    // 🏐 배구: 네이버스포츠 (V리그 남/여) — api-sports 대체, 각 1번씩 호출
    scheduleTasks.push(fetchNaverVolleyball("kovo", naverRangeFrom, naverRangeTo));
    scheduleTasks.push(fetchNaverVolleyball("wkovo", naverRangeFrom, naverRangeTo));

    // LoL 전용 호출 (PandaScore)
    scheduleTasks.push(fetchLOLPanda());

    const rawResults = await Promise.all(scheduleTasks);

    const mergedData = rawResults.flat();

    if (unmappedCountryCodes.size > 0) {
      console.log(`⚠️ 매핑 안 된 fotmob 국가코드 (fotmob-country-map.json에 추가 필요): ${[...unmappedCountryCodes].join(', ')}`);
    }

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
          awayScore: isValidScore(newMatch.awayScore) ? newMatch.awayScore : oldMatch.awayScore
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