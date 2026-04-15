import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- [ 사장님 전용 키 설정 ] ---
const API_SPORTS_KEY = "8e49b25e545ea6bff12f75a858c89529"; // 축구/야구/농구 등 통합 키
const ODDS_API_KEY = "3d7903bd16bdc5cd23fea5cd05a23692";
const PANDASCORE_KEY = "GfxE_2NtG9NN2bI-TW2NobkbeSXIFNLleuR5M4Nz6kgRHs9zxnY"; 

// 종목별 도메인 (사장님이 구독하신 API-Sports 시리즈) 
const SPORTS_CONFIG = {
  soccer: "v3.football.api-sports.io",
  basketball: "v1.basketball.api-sports.io", // NBA 및 일반 농구 통합 
  baseball: "v1.baseball.api-sports.io",
  volleyball: "v1.volleyball.api-sports.io",
  hockey: "v1.hockey.api-sports.io"
};

async function fetchAllData() {
  try {
    let allMatches = [];
    // 오늘부터 2일 뒤까지 총 3일치 데이터 호출 
    const dates = [0, 1, 2].map(offset => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    });

    for (const date of dates) {
      console.log(`📅 ${date} 데이터 수집 중...`);

      // 1. API-Sports 계열 수집
      for (const [sport, host] of Object.entries(SPORTS_CONFIG)) {
        const response = await fetch(`https://${host}/fixtures?date=${date}&timezone=Asia/Seoul`, {
          headers: { "x-rapidapi-key": API_SPORTS_KEY, "x-rapidapi-host": host }
        });
        const result = await response.json();

        if (result.response) {
          const formatted = result.response.map(item => ({
            id: item.id || item.fixture?.id,
            sport: sport,
            league: item.league.name,
            date: item.date || item.fixture?.date,
            home: item.teams.home.name,
            away: item.teams.away.name,
            homeLogo: item.teams.home.logo,
            awayLogo: item.teams.away.logo,
            odds: null,
            h2h: [] // 향후 크롤링이나 추가 API로 채울 공간 
          }));
          allMatches = [...allMatches, ...formatted];
        }
      }
    }

    // 2. LOL 데이터 수집 (Pandascore) 
    console.log("📡 LOL 데이터 수집 중...");
    const lolResp = await fetch(`https://api.pandascore.co/matches/upcoming?token=${PANDASCORE_KEY}`);
    if (lolResp.ok) {
      const lolData = await lolResp.json();
      const lolFormatted = lolData.map(m => ({
        id: m.id, sport: "lol", league: m.league.name, date: m.begin_at,
        home: m.opponents[0]?.opponent.name || "TBD",
        away: m.opponents[1]?.opponent.name || "TBD",
        homeLogo: m.opponents[0]?.opponent.image_url,
        awayLogo: m.opponents[1]?.opponent.image_url
      }));
      allMatches = [...allMatches, ...lolFormatted];
    }

    // 3. 결과 저장
    fs.writeFileSync(path.resolve(__dirname, 'raw-data.json'), JSON.stringify(allMatches, null, 2));
    console.log(`✅ 수집 완료: 총 ${allMatches.length}개 경기 확보`);

  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
  }
}

fetchAllData();