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

// ==========================
// 🔑 환경변수
// ==========================
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const PANDASCORE_KEY = process.env.PANDASCORE_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const RAPID_KEY = process.env.RAPID_KEY;

// ==========================
// 🌐 API HOST
// ==========================
const API_SPORTS_BASE = {
  soccer: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};

const RAPID_LOL_HOST = "esportapi1.p.rapidapi.com";
const RAPID_SOCCER_HOST = "free-api-live-football-data.p.rapidapi.com";

// ==========================
// ⚽ 주요 축구 리그
// ==========================
const MAJOR_SOCCER_LEAGUES = [
  39, 40, 140, 141,
  135, 136,
  78, 79,
  61, 62,
  307, 244,
  106, 233,
  103, 71
];

// ==========================
// 🛠 유틸 함수
// ==========================

function normalizeName(name) {
  if (!name) return "";

  return name
    .toLowerCase()
    .replace(/fc|cf|afc|sc|club/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function formatKSTDate(dateInput) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul"
  });

  const parts = formatter.formatToParts(new Date(dateInput));

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  return `${year}-${month}-${day}`;
}

function isSimilar(a, b) {
  if (!a || !b) return false;

  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);

  let matchCount = 0;

  for (const wordA of aWords) {
    for (const wordB of bWords) {
      if (
        wordA === wordB ||
        wordA.includes(wordB) ||
        wordB.includes(wordA)
      ) {
        matchCount++;
      }
    }
  }

  return matchCount > 0;
}

// ==========================
// 🇰🇷 날짜 범위
// ==========================

function getTargetDates() {
  const dates = [];
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul"
  });

  for (let i = -2; i <= 2; i++) {
    const targetDate = new Date(now.getTime());

    targetDate.setDate(now.getDate() + i);

    const parts = formatter.formatToParts(targetDate);

    const year = parts.find(p => p.type === "year").value;
    const month = parts.find(p => p.type === "month").value;
    const day = parts.find(p => p.type === "day").value;

    dates.push(`${year}-${month}-${day}`);
  }

  return [...new Set(dates)];
}

function getDateRange() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul"
  });

  const formatKst = (dateObj) => {
    const parts = formatter.formatToParts(dateObj);

    const year = parts.find(p => p.type === "year").value;
    const month = parts.find(p => p.type === "month").value;
    const day = parts.find(p => p.type === "day").value;

    return `${year}-${month}-${day}`;
  };

  const fromDate = new Date(
    now.getTime() - (48 * 60 * 60 * 1000)
  );

  const toDate = new Date(
    now.getTime() + (48 * 60 * 60 * 1000)
  );

  return {
    from: formatKst(fromDate),
    to: formatKst(toDate)
  };
}

// ==========================
// 🎯 배당 매칭
// ==========================

function getMatchedData(match, allOdds, allScores) {
  if (!match.date) return match;

  const matchDateStr = formatKSTDate(match.date);

  const homeNorm = normalizeName(match.home);
  const awayNorm = normalizeName(match.away);

  // ==========================
  // 📊 배당 찾기
  // ==========================

  const oddsInfo = (allOdds || []).find(o => {
    const oHomeNorm = normalizeName(o.home_team);
    const oAwayNorm = normalizeName(o.away_team);

    const timeDiff = Math.abs(
      new Date(o.commence_time) - new Date(match.date)
    );

    return (
      timeDiff < 12 * 60 * 60 * 1000 &&
      o.sport_key?.includes(match.sport) &&
      (
        (
          isSimilar(oHomeNorm, homeNorm) &&
          isSimilar(oAwayNorm, awayNorm)
        ) ||
        (
          isSimilar(oHomeNorm, awayNorm) &&
          isSimilar(oAwayNorm, homeNorm)
        )
      )
    );
  });

  const result = {
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

  if (oddsInfo && oddsInfo.bookmakers) {
    const bookies = oddsInfo.bookmakers;

    const priorityKeys = [
      "onexbet",
      "pinnacle",
      "draftkings"
    ];

    let targetBookie = null;

    for (const key of priorityKeys) {
      targetBookie = bookies.find(b => b.key === key);

      if (targetBookie) break;
    }

    const extractMarket = (marketKey) => {
      if (!targetBookie) return null;

      return targetBookie.markets.find(
        m => m.key === marketKey
      );
    };

    // ==========================
    // 🏆 승무패
    // ==========================

    const h2hMarket = extractMarket("h2h");

    if (h2hMarket) {
      result.homeOdd =
        h2hMarket.outcomes.find(o =>
          isSimilar(normalizeName(o.name), homeNorm)
        )?.price || null;

      result.awayOdd =
        h2hMarket.outcomes.find(o =>
          isSimilar(normalizeName(o.name), awayNorm)
        )?.price || null;

      result.drawOdd =
        h2hMarket.outcomes.find(
          o => o.name.toLowerCase() === "draw"
        )?.price || null;
    }

    // ==========================
    // 📉 핸디캡
    // ==========================

    const spreadsMarket = extractMarket("spreads");

    if (spreadsMarket) {
      const hOutcome = spreadsMarket.outcomes.find(o =>
        isSimilar(normalizeName(o.name), homeNorm)
      );

      if (hOutcome) {
        result.handicap = hOutcome.point;
        result.handicapHomeOdd = hOutcome.price;

        result.handicapAwayOdd =
          spreadsMarket.outcomes.find(o =>
            isSimilar(normalizeName(o.name), awayNorm)
          )?.price || null;
      }
    }

    // ==========================
    // 🔥 언더오버
    // ==========================

    const totalsMarket = extractMarket("totals");

    if (totalsMarket) {
      const over = totalsMarket.outcomes.find(
        o => o.name.toLowerCase() === "over"
      );

      if (over) {
        result.overUnder = over.point;
        result.overOdd = over.price;

        result.underOdd =
          totalsMarket.outcomes.find(
            o => o.name.toLowerCase() === "under"
          )?.price || null;
      }
    }
  }

  // ==========================
  // ⚽ 스코어 보조 매칭
  // ==========================

  const scoresList = Array.isArray(allScores)
    ? allScores
    : [];

  const scoreInfo = scoresList.find(s => {
    return (
      formatKSTDate(s.commence_time) === matchDateStr &&
      isSimilar(normalizeName(s.home_team), homeNorm) &&
      isSimilar(normalizeName(s.away_team), awayNorm)
    );
  });

  return {
    ...match,

    homeOdd: result.homeOdd ?? "N/A",
    drawOdd: result.drawOdd ?? "N/A",
    awayOdd: result.awayOdd ?? "N/A",

    handicap: result.handicap ?? null,
    handicapHomeOdd: result.handicapHomeOdd ?? null,
    handicapAwayOdd: result.handicapAwayOdd ?? null,

    overUnder: result.overUnder ?? null,
    overOdd: result.overOdd ?? null,
    underOdd: result.underOdd ?? null,

    homeScore:
      match.homeScore ??
      (
        scoreInfo?.scores?.find(s =>
          isSimilar(normalizeName(s.name), homeNorm)
        )?.score || null
      ),

    awayScore:
      match.awayScore ??
      (
        scoreInfo?.scores?.find(s =>
          isSimilar(normalizeName(s.name), awayNorm)
        )?.score || null
      )
  };
}

// ==========================
// 📡 API 호출
// ==========================

async function fetchApiSports(sport, date) {
  const url =
    `${API_SPORTS_BASE[sport]}/` +
    `${sport === "soccer" ? "fixtures" : "games"}` +
    `?date=${date}`;

  try {
    const res = await fetch(url, {
      headers: {
        "x-apisports-key": API_SPORTS_KEY
      }
    });

    const data = await res.json();

    if (!data.response) return [];

    return data.response.map(item => ({
      id: String(item.fixture?.id || item.id),

      sport,

      country:
        item.league?.country ||
        item.country?.name ||
        "Unknown",

      league: item.league.name,

      date:
        item.fixture?.date ||
        item.date,

      home: item.teams.home.name,
      away: item.teams.away.name,

      homeLogo: item.teams.home.logo,
      awayLogo: item.teams.away.logo,

      homeScore:
        item.goals?.home ??
        item.scores?.home?.total ??
        null,

      awayScore:
        item.goals?.away ??
        item.scores?.away?.total ??
        null
    }));

  } catch (err) {
    return [];
  }
}

// ==========================
// 🚀 메인 실행
// ==========================

async function main() {
  try {
    console.log("🚀 데이터 수집 시작");

    const targetDates = getTargetDates();

    const sports = [
      "soccer",
      "basketball",
      "baseball",
      "hockey",
      "volleyball"
    ];

    const scheduleTasks = [];

    // ==========================
    // 📅 날짜별 API 호출
    // ==========================

    targetDates.forEach(date => {

      sports.forEach(sport => {
        scheduleTasks.push(
          fetchApiSports(sport, date)
        );
      });

      scheduleTasks.push(
        fetchLckRapid(date)
      );
    });

    // 축구 범위 호출
    scheduleTasks.push(
      fetchRapidSoccerRange()
    );

    // LoL Panda
    scheduleTasks.push(
      fetchLOLPanda()
    );

    // ==========================
    // 📡 병렬 호출
    // ==========================

    const [rawResults, oddsAndScores] =
      await Promise.all([
        Promise.all(scheduleTasks),
        fetchOddsAndScores()
      ]);

    // ==========================
    // 🎯 배당 병합
    // ==========================

    const mergedData = rawResults
      .flat()
      .map(m =>
        getMatchedData(
          m,
          oddsAndScores.odds,
          oddsAndScores.scores
        )
      );

    // ==========================
    // 📁 폴더 생성
    // ==========================

    await fs.mkdir(
      OUTPUT_DIR,
      { recursive: true }
    );

    // ==========================
    // 📚 기존 데이터 로드
    // ==========================

    const map = new Map();

    let existingFixtures = [];

    try {
      const content = await fs.readFile(
        ALL_FIXTURES_FILE,
        "utf-8"
      );

      existingFixtures = JSON.parse(content || "[]");

    } catch (e) {
      console.log(
        "ℹ️ 기존 all-fixtures.json 없음"
      );
    }

    // ==========================
    // 🧠 기존 데이터 Map 저장
    // ==========================

    existingFixtures.forEach(m => {

      const dKey = formatKSTDate(m.date);

      const key =
        `${dKey}_` +
        `${normalizeName(m.home)}_` +
        `${normalizeName(m.away)}`;

      map.set(key, m);
    });

    // ==========================
    // 🔄 병합 처리
    // ==========================

    mergedData.forEach(newMatch => {

      if (!newMatch.date) return;

      const dKey = formatKSTDate(newMatch.date);

      const key =
        `${dKey}_` +
        `${normalizeName(newMatch.home)}_` +
        `${normalizeName(newMatch.away)}`;

      if (map.has(key)) {

        const oldMatch = map.get(key);

        const isValidScore = (score) =>
          score !== null &&
          score !== undefined &&
          String(score).trim() !== "";

        map.set(key, {
          ...oldMatch,
          ...newMatch,

          homeScore:
            isValidScore(newMatch.homeScore)
              ? newMatch.homeScore
              : oldMatch.homeScore,

          awayScore:
            isValidScore(newMatch.awayScore)
              ? newMatch.awayScore
              : oldMatch.awayScore,

          homeOdd:
            (
              newMatch.homeOdd &&
              newMatch.homeOdd !== "N/A" &&
              newMatch.homeOdd !== ""
            )
              ? newMatch.homeOdd
              : oldMatch.homeOdd,

          awayOdd:
            (
              newMatch.awayOdd &&
              newMatch.awayOdd !== "N/A" &&
              newMatch.awayOdd !== ""
            )
              ? newMatch.awayOdd
              : oldMatch.awayOdd,

          drawOdd:
            (
              newMatch.drawOdd &&
              newMatch.drawOdd !== "N/A" &&
              newMatch.drawOdd !== ""
            )
              ? newMatch.drawOdd
              : oldMatch.drawOdd
        });

      } else {
        map.set(key, newMatch);
      }
    });

    // ==========================
    // 📦 최종 정리
    // ==========================

    const finalAllFixtures =
      Array.from(map.values());

    finalAllFixtures.sort(
      (a, b) =>
        new Date(a.date) -
        new Date(b.date)
    );

    console.log(`기존: ${existingFixtures.length}건`);
    console.log(`현재: ${finalAllFixtures.length}건`);
    console.log(
      `추가됨: ${
        finalAllFixtures.length -
        existingFixtures.length
      }건`
    );

    // ==========================
    // 💾 저장
    // ==========================

    await fs.writeFile(
      ALL_FIXTURES_FILE,
      JSON.stringify(finalAllFixtures, null, 2)
    );

    const todayKst =
      formatKSTDate(new Date());

    await fs.writeFile(
      path.join(
        OUTPUT_DIR,
        `${todayKst}.json`
      ),
      JSON.stringify(mergedData, null, 2)
    );

    console.log(
      `✅ 업데이트 완료: 총 ${finalAllFixtures.length}건`
    );

  } catch (err) {
    console.error(
      "❌ 통합 프로세스 에러:",
      err.stack
    );
  }
}

main();