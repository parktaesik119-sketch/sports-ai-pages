import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ==========================
// 📁 경로 설정
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, "../database");
const ALL_FIXTURES_FILE = path.join(OUTPUT_DIR, "all-fixtures.json");

// ==========================
// 🔑 API KEY
// ==========================
const API_SPORTS_KEY = "8e49b25e545ea6bff12f75a858c89529";
const PANDASCORE_KEY = "GfxE_2NtG9NN2bI-TW2NobkbeSXIFNLleuR5M4Nz6kgRHs9zxnY";

// ==========================
// 🌐 BASE URL
// ==========================
const BASE_URL = {
  football: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
  baseball: "https://v1.baseball.api-sports.io",
  hockey: "https://v1.hockey.api-sports.io",
  volleyball: "https://v1.volleyball.api-sports.io"
};

// ==========================
// 📅 날짜 (오늘 +2일)
// ==========================
function getNext3Days() {
  const dates = [];

  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  return dates;
}

// ==========================
// ⚽ API 호출
// ==========================
async function fetchApiSports(sport, date) {
  try {
    let endpoint = "";

    switch (sport) {
      case "football":
        endpoint = `/fixtures?date=${date}`;
        break;
      default:
        endpoint = `/games?date=${date}`;
    }

    const res = await fetch(`${BASE_URL[sport]}${endpoint}`, {
      headers: {
        "x-apisports-key": API_SPORTS_KEY
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.response) return [];

    return json.response.map((item) => ({
      sport,
      league: item.league?.name || "Unknown League",

      home:
        item.teams?.home?.name ||
        item.home?.name ||
        "TBD",

      away:
        item.teams?.away?.name ||
        item.away?.name ||
        "TBD",

      homeLogo:
        item.teams?.home?.logo ||
        item.home?.logo ||
        null,

      awayLogo:
        item.teams?.away?.logo ||
        item.away?.logo ||
        null,

      date:
        item.fixture?.date ||
        item.date ||
        null
    }));
  } catch (err) {
    console.error(`❌ ${sport} (${date}) error:`, err.message);
    return [];
  }
}

// ==========================
// 🎮 LOL
// ==========================
async function fetchLOL() {
  try {
    const now = new Date();
    const future = new Date();
    future.setDate(now.getDate() + 2);

    const url = `https://api.pandascore.co/lol/matches?range[begin_at]=${now.toISOString()},${future.toISOString()}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${PANDASCORE_KEY}`
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    return json.map((match) => ({
      sport: "lol",
      league: match.league?.name || "Unknown League",

      home: match.opponents?.[0]?.opponent?.name || "TBD",
      away: match.opponents?.[1]?.opponent?.name || "TBD",

      homeLogo: match.opponents?.[0]?.opponent?.image_url || null,
      awayLogo: match.opponents?.[1]?.opponent?.image_url || null,

      date: match.begin_at || null
    }));
  } catch (err) {
    console.error("❌ LOL error:", err.message);
    return [];
  }
}

// ==========================
// 📦 누적 저장 함수
// ==========================
async function updateAllFixtures(newData) {
  try {
    let existing = [];

    // 기존 파일 읽기
    try {
      const file = await fs.readFile(ALL_FIXTURES_FILE, "utf-8");
      existing = JSON.parse(file);
    } catch {
      existing = [];
    }

    // 👉 간단한 중복 제거 (date + home + away 기준)
    const map = new Map();

    [...existing, ...newData].forEach((match) => {
      const key = `${match.date}_${match.home}_${match.away}`;
      map.set(key, match);
    });

    const merged = Array.from(map.values());

    await fs.writeFile(
      ALL_FIXTURES_FILE,
      JSON.stringify(merged, null, 2)
    );

    console.log(`📦 누적 데이터 저장 완료 (총 ${merged.length}개)`);

  } catch (err) {
    console.error("❌ 누적 저장 에러:", err.message);
  }
}

// ==========================
// 🚀 메인
// ==========================
async function main() {
  try {
    console.log("📡 Fetching sports data (3 days)...");

    const sports = ["football", "basketball", "baseball", "hockey", "volleyball"];
    const dates = getNext3Days();

    const tasks = [];

    for (const date of dates) {
      for (const sport of sports) {
        tasks.push(fetchApiSports(sport, date));
      }
    }

    tasks.push(fetchLOL());

    const results = await Promise.all(tasks);
    const merged = results.flat();

    console.log(`✅ total matches: ${merged.length}`);

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // 📅 오늘 파일 저장
    const today = new Date().toISOString().split("T")[0];
    const dailyFile = path.join(OUTPUT_DIR, `${today}.json`);

    await fs.writeFile(dailyFile, JSON.stringify(merged, null, 2));
    console.log(`💾 일일 저장 완료 → ${dailyFile}`);

    // 📦 누적 저장
    await updateAllFixtures(merged);

  } catch (err) {
    console.error("❌ main error:", err.message);
  }
}

main();