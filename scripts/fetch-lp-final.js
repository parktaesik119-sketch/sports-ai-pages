import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, "../database");
const SAVE_FILE = path.join(OUTPUT_DIR, "leaguepedia-test.json");

// 차단 방지를 위한 충분한 대기 시간
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchLeaguepediaFinal() {
  const start = "2026-04-22 00:00:00";
  const end = "2026-04-26 23:59:59";
  
  console.log(`🚀 리그피디아 수집 시도: ${start} ~ ${end}`);
  console.log("⚠️ 서버 안정화를 위해 5초 대기합니다. (지금 바로 재실행하지 마세요)");
  await sleep(5000); 

  const fields = "SG.DateTime_UTC,SG.Team1,SG.Team2,SG.Team1Score,SG.Team2Score,SG.Tournament,SG.MatchId";
  const where = `SG.DateTime_UTC >= "${start}" AND SG.DateTime_UTC <= "${end}"`;
  const url = `https://lol.fandom.com/api.php?action=cargoquery&tables=ScoreboardGames=SG&fields=${encodeURIComponent(fields)}&where=${encodeURIComponent(where)}&limit=100&format=json`;

  try {
    const res = await fetch(url, { 
      headers: { 
        // 식별 가능한 User-Agent 설정
        "User-Agent": "MyEsportsAnalysisBot/1.1 (Chrome-Compatible)"
      } 
    });

    const data = await res.json();

    // 1. 서버 차단 여부 재확인
    if (data.error) {
      if (data.error.code === "ratelimited") {
        console.error("❌ 아직 차단이 풀리지 않았습니다. 30분 정도 뒤에 다시 시도하세요.");
        return;
      }
      throw new Error(data.error.info);
    }

    if (!data.cargoquery || data.cargoquery.length === 0) {
      console.log("⚠️ 수집된 데이터가 없습니다.");
      return;
    }

    const results = [];
    data.cargoquery.forEach((item) => {
      const m = item.title;
      
      // 2. 유효성 검사 (날짜와 팀명이 없으면 아예 처리 안 함)
      if (!m || !m.DateTime_UTC || !m.Team1 || !m.Team2) return;

      try {
        // 3. 안전한 날짜 변환 (null/undefined 체크 후 replace)
        const rawDate = String(m.DateTime_UTC);
        const formattedDate = rawDate.includes(" ") 
          ? rawDate.replace(" ", "T") + "Z" 
          : rawDate;

        results.push({
          id: `lp-${m.MatchId || rawDate}-${m.Team1}`.replace(/\s+/g, ""),
          sport: "lol",
          league: m.Tournament || "League",
          date: formattedDate,
          home: m.Team1,
          away: m.Team2,
          homeScore: parseInt(m.Team1Score) || 0,
          awayScore: parseInt(m.Team2Score) || 0,
          source: "leaguepedia"
        });
      } catch (e) {
        // 개별 데이터 처리 중 에러가 나도 다음 데이터로 넘어감
      }
    });

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(SAVE_FILE, JSON.stringify(results, null, 2));

    console.log(`✅ 성공: ${results.length}건 저장 완료!`);
    if (results.length > 0) {
      console.table(results.slice(0, 3).map(r => ({ 일시: r.date, 경기: `${r.home} vs ${r.away}` })));
    }

  } catch (err) {
    console.error(`❌ 치명적 오류: ${err.message}`);
  }
}

fetchLeaguepediaFinal();