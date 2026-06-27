import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, "../database");
const ALL_FIXTURES_FILE = path.join(OUTPUT_DIR, "all-fixtures.json");

const HIGHLIGHTLY_KEY = "749bc19777msh67bb1920124b5d7p1cf477jsn772cbb1ccdd3";
const HIGHLIGHTLY_HOST = "volleyball-highlights-api.p.rapidapi.com";

const TARGET_VOLLEYBALL_LEAGUES = [
  'V-LEAGUE', 'KOVO', 'KOREA V', 'V.LEAGUE', 'SUPER LEAGUE',
  'WORLD', 'WORLDS', 'INTERNATIONAL', 'FRIENDLY INTERNATIONAL',
  'NATIONS LEAGUE WOMEN', 'NATIONS LEAGUE'
];

function normalizeName(name) {
  if (!name) return "";
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

// DB 팀명: "Italy W" → "italyw" → "italywomen" 으로 변환
function normalizeTeamName(name) {
  const n = normalizeName(name);
  return n.endsWith('w') ? n.slice(0, -1) + 'women' : n;
}

function isTargetVolleyballLeague(league) {
  const upper = (league || "").toUpperCase();
  return TARGET_VOLLEYBALL_LEAGUES.some(t => upper.includes(t));
}

function isValidScore(score) {
  return score !== null && score !== undefined && String(score).trim() !== '';
}

async function fetchVolleyballByDate(date) {
  const url = `https://${HIGHLIGHTLY_HOST}/matches?date=${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": HIGHLIGHTLY_KEY,
        "x-rapidapi-host": HIGHLIGHTLY_HOST
      }
    });
    const data = await res.json();
    if (!Array.isArray(data?.data)) return [];
    return data.data.map(item => ({
      id: `hl-vb-${item.id}`,
      sport: "volleyball",
      country: item.country?.name || "Unknown",
      league: item.league?.name || "",
      date: item.date,
      home: item.homeTeam?.name || "",
      away: item.awayTeam?.name || "",
      homeLogo: item.homeTeam?.logo || "",
      awayLogo: item.awayTeam?.logo || "",
      homeScore: item.state?.score?.current ? parseInt(item.state.score.current.split(" - ")[0]) : null,
      awayScore: item.state?.score?.current ? parseInt(item.state.score.current.split(" - ")[1]) : null
    }));
  } catch (err) {
    console.error(`❌ Highlightly 호출 실패 (${date}):`, err.message);
    return [];
  }
}

async function main() {
  console.log("🏐 배구 스코어 업데이트 시작...\n");

  let existingFixtures = [];
  try {
    const content = await fs.readFile(ALL_FIXTURES_FILE, "utf-8");
    existingFixtures = JSON.parse(content || "[]");
  } catch (e) {
    console.error("❌ all-fixtures.json 로드 실패:", e.message);
    process.exit(1);
  }

  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];

const targetMatches = existingFixtures.filter(m => {
  const matchDateKST = new Date(new Date(m.date).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (
    m.sport === "volleyball"
    && m.date >= "2026-05-01"
    && matchDateKST < todayKST
    && (
  (m.homeScore === null && m.awayScore === null) ||
  (m.homeScore === 0 && m.awayScore === 0)
)
    && isTargetVolleyballLeague(m.league)
  );
});

  if (targetMatches.length === 0) {
    console.log("✅ 업데이트할 스코어 없음. 종료.");
    return;
  }

  const targetDates = [...new Set(targetMatches.map(m =>
  new Date(new Date(m.date).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
))].sort();
  console.log(`📅 스코어 없는 날짜: ${targetDates.length}개`);
  console.log(`🎯 업데이트 대상 경기: ${targetMatches.length}건\n`);

  const fetchedMap = new Map();
  for (const date of targetDates) {
    console.log(`📡 호출 중: ${date}`);
    const results = await fetchVolleyballByDate(date);
    results.forEach(m => {
  const dateKST = new Date(new Date(m.date).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const key = `${dateKST}_${normalizeTeamName(m.home)}_${normalizeTeamName(m.away)}`;
  fetchedMap.set(key, m);
});
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\n✅ API 호출 완료. 수집된 경기: ${fetchedMap.size}건\n`);

  let updatedCount = 0;
  let failCount = 0;
  const updatedFixtures = existingFixtures.map(m => {
    if (m.sport !== "volleyball" || !isTargetVolleyballLeague(m.league)) return m;
    if (isValidScore(m.homeScore) || isValidScore(m.awayScore)) {
  if (m.homeScore === 0 && m.awayScore === 0) {
    // 0:0은 무효로 보고 재수집 진행
  } else {
    return m; // 실제 스코어 있으면 스킵
  }
}

    const matchDateKST = new Date(new Date(m.date).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const key = `${matchDateKST}_${normalizeTeamName(m.home)}_${normalizeTeamName(m.away)}`;
    const fetched = fetchedMap.get(key);
    if (!fetched) {
      failCount++;
      console.log(`⚠️ 매칭 실패: ${m.date.slice(0, 10)} | ${m.league} | ${m.home} vs ${m.away}`);
      return m;
    }

    if (isValidScore(fetched.homeScore) || isValidScore(fetched.awayScore)) {
      updatedCount++;
      console.log(`🔄 업데이트: ${m.date.slice(0, 10)} | ${m.home} vs ${m.away} | ${fetched.homeScore}-${fetched.awayScore}`);
      return {
        ...m,
        homeScore: isValidScore(fetched.homeScore) ? fetched.homeScore : m.homeScore,
        awayScore: isValidScore(fetched.awayScore) ? fetched.awayScore : m.awayScore,
      };
    }
    return m;
  });

  await fs.writeFile(ALL_FIXTURES_FILE, JSON.stringify(updatedFixtures, null, 2));
  console.log(`\n✅ 완료: ${updatedCount}건 업데이트됨 / ${failCount}건 매칭 실패`);
  console.log(`📁 저장: ${ALL_FIXTURES_FILE}`);
}

main();