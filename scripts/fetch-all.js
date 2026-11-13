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
// 🏀 NBA — 다음 스포츠 API (기존 정상 작동 코드 유지)
// ─────────────────────────────────────────────

const DAUM_NBA_TEAM_MAP = {
  "애틀랜타": "Atlanta Hawks",
  "보스턴": "Boston Celtics",
  "브루클린": "Brooklyn Nets",
  "샬럿": "Charlotte Hornets",
  "시카고": "Chicago Bulls",
  "클리블랜드": "Cleveland Cavaliers",
  "댈러스": "Dallas Mavericks",
  "덴버": "Denver Nuggets",
  "디트로이트": "Detroit Pistons",
  "골든스테이트": "Golden State Warriors",
  "휴스턴": "Houston Rockets",
  "인디애나": "Indiana Pacers",
  "LA클리퍼스": "LA Clippers",
  "LA레이커스": "Los Angeles Lakers",
  "멤피스": "Memphis Grizzlies",
  "마이애미": "Miami Heat",
  "밀워키": "Milwaukee Bucks",
  "미네소타": "Minnesota Timberwolves",
  "뉴올리언스": "New Orleans Pelicans",
  "뉴욕": "New York Knicks",
  "오클라호마시티": "Oklahoma City Thunder",
  "올랜도": "Orlando Magic",
  "필라델피아": "Philadelphia 76ers",
  "피닉스": "Phoenix Suns",
  "포틀랜드": "Portland Trail Blazers",
  "새크라멘토": "Sacramento Kings",
  "샌안토니오": "San Antonio Spurs",
  "토론토": "Toronto Raptors",
  "유타": "Utah Jazz",
  "워싱턴": "Washington Wizards"
};

function normalizeDaumNbaTeamName(name) {
  return String(name || "").replace(/\s+/g, "").trim();
}

function getDaumNbaSeasonKey(fromDate) {
  const [year, month] = String(fromDate).split("-").map(Number);
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

async function fetchDaumNBA(fromDate, toDate) {
  const from = String(fromDate).replace(/-/g, "");
  const to = String(toDate).replace(/-/g, "");
  const seasonKey = getDaumNbaSeasonKey(fromDate);

  const url =
    `https://sports.daum.net/api/arms/SPORTS_SCHEDULE` +
    `?leagueCode=nba&fromDate=${from}&toDate=${to}&seasonKey=${seasonKey}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Referer": "https://sports.daum.net/",
        "Origin": "https://sports.daum.net",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data?.code !== 200) {
      throw new Error(`Daum API 응답 코드: ${data?.code ?? "없음"}`);
    }

    const schedule = data.document?.schedule;

    if (!schedule || typeof schedule !== "object") {
      throw new Error("응답에 경기 일정(document.schedule)이 없습니다.");
    }

    const games = Object.values(schedule).flat();

    const results = games.map(game => {
      const homeName =
        DAUM_NBA_TEAM_MAP[normalizeDaumNbaTeamName(game.homeTeamName)];
      const awayName =
        DAUM_NBA_TEAM_MAP[normalizeDaumNbaTeamName(game.awayTeamName)];

      if (!homeName || !awayName) {
        console.warn(
          `⚠️ 다음 NBA 팀 이름 매핑 누락: ${game.homeTeamName} vs ${game.awayTeamName}`
        );
        return null;
      }

      const gameDate = String(game.startDate || "");
      const gameTime = String(game.startTime || "0000").padStart(4, "0");

      if (!/^\d{8}$/.test(gameDate) || !/^\d{4}$/.test(gameTime)) {
        console.warn(`⚠️ 다음 NBA 경기 날짜/시간 형식 오류: ${gameDate} ${gameTime}`);
        return null;
      }

      const kstDateTime =
        `${gameDate.slice(0, 4)}-${gameDate.slice(4, 6)}-${gameDate.slice(6, 8)}` +
        `T${gameTime.slice(0, 2)}:${gameTime.slice(2, 4)}:00+09:00`;

      const isFinished =
        game.gameStatus === "END" || game.periodType === "END";

      return {
        id: `daum-nba-${game.gameId}`,
        sport: "basketball",
        country: "USA",
        league: "NBA",
        date: new Date(kstDateTime).toISOString(),
        home: homeName,
        away: awayName,
        homeLogo: game.homeTeamImageUrl
          ? game.homeTeamImageUrl.replace(/^http:/, "https:")
          : null,
        awayLogo: game.awayTeamImageUrl
          ? game.awayTeamImageUrl.replace(/^http:/, "https:")
          : null,
        homeScore: isFinished && game.homeResult != null
          ? Number(game.homeResult)
          : null,
        awayScore: isFinished && game.awayResult != null
          ? Number(game.awayResult)
          : null
      };
    }).filter(Boolean);

    console.log(
      `✅ 다음 NBA 일정 수집 완료: ${results.length}경기 (${from} ~ ${to})`
    );

    return results;

  } catch (err) {
    console.error(`❌ 다음 NBA 일정 조회 실패: ${err.message}`);
    return [];
  }
}


// ─────────────────────────────────────────────
// 📡 다음 스포츠 공통 일정 수집기 (KBL/WKBL/KBO/MLB/V리그)
// ─────────────────────────────────────────────
const DAUM_TEAM_MAPS = {
  kbl: {
    "서울SK":"SK Knights", "창원LG":"Changwon LG", "울산현대모비스":"Ulsan Hyundai Mobis",
    "수원KT":"Suwon KT", "대구한국가스공사":"Daegu KOGAS", "안양정관장":"Anyang JungKwanJang",
    "원주DB":"Wonju DB", "고양소노":"Goyang Sono", "부산KCC":"KCC Egis", "서울삼성":"Samsung Thunders"
  },
  wkbl: {
    "우리은행":"Woori Bank WON", "신한은행":"Shinhan Bank S-Birds", "KB스타즈":"KB Stars",
    "삼성생명":"Samsung Blue Minx", "하나은행":"Hana Bank", "BNK썸":"BNK Sum"
  },
  kbo: {
    "한화":"Hanwha Eagles", "KIA":"KIA Tigers", "LG":"LG Twins", "롯데":"Lotte Giants",
    "NC":"NC Dinos", "두산":"Doosan Bears", "SSG":"SSG Landers", "삼성":"Samsung Lions",
    "키움":"Kiwoom Heroes", "KT":"KT Wiz Suwon"
  },
  mlb: {
    "애리조나":"Arizona Diamondbacks", "애리조나D":"Arizona Diamondbacks", "애틀랜타":"Atlanta Braves", "볼티모어":"Baltimore Orioles",
    "보스턴":"Boston Red Sox", "시카고C":"Chicago Cubs", "시카고W":"Chicago White Sox", "시카고컵스":"Chicago Cubs", "시카고화이트삭스":"Chicago White Sox",
    "신시내티":"Cincinnati Reds", "클리블랜드":"Cleveland Guardians", "콜로라도":"Colorado Rockies",
    "디트로이트":"Detroit Tigers", "휴스턴":"Houston Astros", "캔자스시티":"Kansas City Royals",
    "LA에인절스":"Los Angeles Angels", "LA에인절스":"Los Angeles Angels", "LA다저스":"Los Angeles Dodgers", "마이애미":"Miami Marlins",
    "밀워키":"Milwaukee Brewers", "미네소타":"Minnesota Twins", "뉴욕M":"New York Mets", "뉴욕메츠":"New York Mets",
    "뉴욕Y":"New York Yankees", "뉴욕양키스":"New York Yankees", "오클랜드":"Athletics", "필라델피아":"Philadelphia Phillies",
    "피츠버그":"Pittsburgh Pirates", "샌디에이고":"San Diego Padres", "샌프란시스코":"San Francisco Giants",
    "시애틀":"Seattle Mariners", "세인트루이스":"St.Louis Cardinals", "탬파베이":"Tampa Bay Rays",
    "텍사스":"Texas Rangers", "토론토":"Toronto Blue Jays", "워싱턴":"Washington Nationals"
  },
  vl: {
    "대한항공":"Korean Air Jumbos", "삼성화재":"Samsung Fire Bluefangs", "KB손해보험":"KB Insurance Stars",
    "현대캐피탈":"Hyundai Capital Skywalkers", "한국전력":"KEPCO Vixtorm", "OK저축은행":"OK Savings Bank OKman",
    "우리카드":"Woori Card WON"
  },
  wvl: {
  "현대건설":"Hyundai E&C Hillstate",
  "도로공사":"Korea Expressway Hi-pass",
  "한국도로공사":"Korea Expressway Hi-pass",
  "정관장":"Jungkwanjang Red Sparks",
  "흥국생명":"Heungkuk Life Pink Spiders",
  "GS칼텍스":"GS Caltex Seoul KIXX",
  "IBK기업은행":"IBK Altos",
  "SOOP":"SOOP Supers"
}
};

function normalizeDaumTeamName(name) {
  return String(name || "").replace(/[\s·ㆍ]/g, "").trim();
}

function getDaumSeasonKey(leagueCode, fromDate) {
  if (["kbo", "mlb"].includes(leagueCode)) return String(fromDate).slice(0, 4);
  const year = Number(String(fromDate).slice(0, 4));
  const month = Number(String(fromDate).slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

async function fetchDaumLeague(leagueCode, fromDate, toDate, options = {}) {
  const from = String(fromDate).replace(/-/g, "");
  const to = String(toDate).replace(/-/g, "");
  const seasonKey = getDaumSeasonKey(leagueCode, fromDate);
  const queryLeague = options.queryLeague || leagueCode;
  const url = `https://sports.daum.net/api/arms/SPORTS_SCHEDULE?leagueCode=${encodeURIComponent(queryLeague)}&fromDate=${from}&toDate=${to}&seasonKey=${seasonKey}`;
  const teamMap = DAUM_TEAM_MAPS[leagueCode];
  const sport = ["kbl", "wkbl"].includes(leagueCode) ? "basketball" :
    ["vl", "wvl"].includes(leagueCode) ? "volleyball" : "baseball";
  const country = ["kbl", "wkbl", "kbo", "vl", "wvl"].includes(leagueCode) ? "South Korea" : "USA";
  const leagueName = ({kbl:"KBL", wkbl:"WKBL W", kbo:"KBO", mlb:"MLB", vl:"KOVO", wvl:"WKOVO W"})[leagueCode];

  try {
    const res = await fetch(url, {
      headers: {
        "Referer": "https://sports.daum.net/",
        "Origin": "https://sports.daum.net",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.code !== 200) throw new Error(`Daum API 응답 코드: ${data?.code ?? "없음"}`);
    const schedule = data.document?.schedule;
    if (!schedule || typeof schedule !== "object") throw new Error("응답에 document.schedule이 없습니다.");

    const games = Object.values(schedule).flat();
    const results = games.map(game => {
      const homeKey = normalizeDaumTeamName(game.homeTeamName);
      const awayKey = normalizeDaumTeamName(game.awayTeamName);
      const home = teamMap[homeKey];
      const away = teamMap[awayKey];
      if (!home || !away) {
        console.warn(`⚠️ 다음 ${leagueName} 팀 매핑 누락: ${game.homeTeamName} vs ${game.awayTeamName}`);
        return null;
      }
      const gameDate = String(game.startDate || "");
      const gameTime = String(game.startTime || "0000").padStart(4, "0");
      if (!/^\d{8}$/.test(gameDate) || !/^\d{4}$/.test(gameTime)) return null;
      const kstDateTime = `${gameDate.slice(0,4)}-${gameDate.slice(4,6)}-${gameDate.slice(6,8)}T${gameTime.slice(0,2)}:${gameTime.slice(2,4)}:00+09:00`;
      const isFinished = game.gameStatus === "END" || game.periodType === "END";
      return {
        id: `daum-${leagueCode}-${game.gameId}`,
        sport, country, league: leagueName,
        date: new Date(kstDateTime).toISOString(), home, away,
        homeLogo: game.homeTeamImageUrl ? game.homeTeamImageUrl.replace(/^http:/, "https:") : null,
        awayLogo: game.awayTeamImageUrl ? game.awayTeamImageUrl.replace(/^http:/, "https:") : null,
        homeScore: isFinished && game.homeResult != null ? Number(game.homeResult) : null,
        awayScore: isFinished && game.awayResult != null ? Number(game.awayResult) : null
      };
    }).filter(Boolean);
    console.log(`✅ 다음 ${leagueName} 일정 수집 완료: ${results.length}경기 (${from} ~ ${to})`);
    return results;
  } catch (err) {
    console.error(`❌ 다음 ${leagueName} 일정 조회 실패: ${err.message}`);
    return [];
  }
}

async function fetchDaumKBL(fromDate, toDate) { return fetchDaumLeague("kbl", fromDate, toDate); }
async function fetchDaumWKBL(fromDate, toDate) { return fetchDaumLeague("wkbl", fromDate, toDate); }
async function fetchDaumKBO(fromDate, toDate) { return fetchDaumLeague("kbo", fromDate, toDate); }
async function fetchDaumMLB(fromDate, toDate) { return fetchDaumLeague("mlb", fromDate, toDate); }
async function fetchDaumVolleyball(leagueCode, fromDate, toDate) {
  return fetchDaumLeague(leagueCode, fromDate, toDate);
}


// ─────────────────────────────────────────────
// ⚾ NPB — SPAIA 공개 일정 API (네이버 미사용)
// 주간 일정 JSON: /weekly_schedule?from=YYYYMMDD&to=YYYYMMDD
// ─────────────────────────────────────────────
const SPAIA_NPB_TEAM_MAP = {
  1: "Yomiuri Giants",
  2: "Tokyo Yakult Swallows",
  3: "Yokohama DeNA BayStars",
  4: "Chunichi Dragons",
  5: "Hanshin Tigers",
  6: "Hiroshima Toyo Carp",
  7: "Saitama Seibu Lions",
  8: "Hokkaido Nippon-Ham Fighters",
  9: "Chiba Lotte Marines",
  11: "Orix Buffaloes",
  12: "Fukuoka SoftBank Hawks",
  376: "Tohoku Rakuten Golden Eagles"
};

async function fetchSpaiaNPB(fromDate, toDate) {
  const from = String(fromDate).replace(/-/g, "");
  const to = String(toDate).replace(/-/g, "");
  const url = `https://spaia.jp/baseball/npb/api/weekly_schedule?from=${from}&to=${to}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://spaia.jp/"
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("SPAIA 응답이 경기 배열 형식이 아닙니다.");
    }

    const results = data.map(game => {
      const home = SPAIA_NPB_TEAM_MAP[Number(game.HTeamID)];
      const away = SPAIA_NPB_TEAM_MAP[Number(game.VTeamID)];
      if (!home || !away) {
        console.warn(`⚠️ SPAIA NPB 팀 매핑 누락: ${game.HTeamID}/${game.HTeamNameS} vs ${game.VTeamID}/${game.VTeamNameS}`);
        return null;
      }

      const rawDate = String(game.DateJPN ?? game.GameDate ?? "");
      const gameDate = rawDate.replace(/[^0-9]/g, "").slice(0, 8);
      const rawTime = String(game.TimeJPN ?? game.GameTime ?? "0000");
      const gameTime = rawTime.replace(/[^0-9]/g, "").slice(0, 4).padStart(4, "0");
      if (!/^\d{8}$/.test(gameDate) || !/^\d{4}$/.test(gameTime)) return null;

      const kstDateTime = `${gameDate.slice(0, 4)}-${gameDate.slice(4, 6)}-${gameDate.slice(6, 8)}T${gameTime.slice(0, 2)}:${gameTime.slice(2, 4)}:00+09:00`;
      const isFinished = Number(game.GameStateID) === 4 || game.GameStateName === "試合終了";
      const homeScore = game.HScore ?? game.H_Score_R;
      const awayScore = game.VScore ?? game.V_Score_R;

      return {
        id: `spaia-npb-${game.GameID ?? game.ID}`,
        sport: "baseball",
        country: "Japan",
        league: "NPB",
        date: new Date(kstDateTime).toISOString(),
        home,
        away,
        homeLogo: null,
        awayLogo: null,
        homeScore: isFinished && homeScore != null ? Number(homeScore) : null,
        awayScore: isFinished && awayScore != null ? Number(awayScore) : null
      };
    }).filter(Boolean);

    console.log(`✅ SPAIA NPB 일정 수집 완료: ${results.length}경기 (${from} ~ ${to})`);
    return results;
  } catch (err) {
    console.error(`❌ SPAIA NPB 일정 조회 실패: ${err.message}`);
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
// KBO/MLB/NPB는 다음·SPAIA에서 수집하고, CPBL은 FlashScore에서 별도 수집한다.
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
    // ⚠️ baseball은 다음·SPAIA 전용 루프에서 별도 처리
    // ⚠️ basketball은 다음 스포츠 전용 루프에서 별도 처리
    // ⚠️ volleyball은 다음 스포츠 전용 루프에서 별도 처리
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
    scheduleTasks.push(fetchDaumKBO(shortRangeFrom, shortRangeTo)); // KBO - 다음 스포츠
    scheduleTasks.push(fetchDaumMLB(shortRangeFrom, shortRangeTo)); // MLB - 다음 스포츠
    // NPB는 다음 스포츠 미지원이므로 SPAIA 공개 일정 API에서 별도 수집
    scheduleTasks.push(fetchSpaiaNPB(shortRangeFrom, shortRangeTo));

    // ⚾ CPBL / 🏒 하키(NHL+KHL): 날짜별 호출 — 야구와 동일하게 D-1~D+1 범위만 사용
    shortRangeDates.forEach(date => {
      scheduleTasks.push(fetchFlashscoreCPBL(date));
      scheduleTasks.push(fetchHighlightlyHockey(date));
    });

    // 🏀🏐 다음 스포츠(농구/배구)가 공유하는 날짜 범위 — 범위 방식으로 호출
    const scheduleRangeFrom = targetDates[0];
    const scheduleRangeTo = targetDates[targetDates.length - 1];

   // 🏀 NBA: 다음 스포츠 API
scheduleTasks.push(fetchDaumNBA(scheduleRangeFrom, scheduleRangeTo));

// 🏀 KBL / WKBL: 다음 스포츠 API
scheduleTasks.push(fetchDaumKBL(scheduleRangeFrom, scheduleRangeTo));
scheduleTasks.push(fetchDaumWKBL(scheduleRangeFrom, scheduleRangeTo));

    // 🏐 V리그 남/여: 다음 스포츠 API
    scheduleTasks.push(fetchDaumVolleyball("vl", scheduleRangeFrom, scheduleRangeTo));
    scheduleTasks.push(fetchDaumVolleyball("wvl", scheduleRangeFrom, scheduleRangeTo));

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