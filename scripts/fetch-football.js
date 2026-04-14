import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 기존 API 키 사용
const API_KEY = process.env.FOOTBALL_API_KEY || "사장님의_API_키"; 

async function fetchThreeDaysMatches() {
  try {
    // 1. 날짜 배열 생성 (오늘, 내일, 모레)
    const dates = [0, 1, 2].map(offset => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    });

    console.log(`🚀 데이터 수집 시작: ${dates.join(', ')}`);

    let allMatches = [];

    // 2. 각 날짜별로 API 호출 루프
    for (const date of dates) {
      console.log(`📅 ${date} 경기 불러오는 중...`);
      
      const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Asia/Seoul`, {
        method: "GET",
        headers: {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": "v3.football.api-sports.io"
        }
      });

      const result = await response.json();

      if (result.response && result.response.length > 0) {
        // 사장님 전략대로 배당률이 있거나 주요 리그인 것들 위주로 데이터 가공
        const filtered = result.response.map(item => ({
          id: item.fixture.id,
          date: item.fixture.date,
          league: item.league.name,
          home: item.teams.home.name,
          away: item.teams.away.name,
          homeLogo: item.teams.home.logo,
          awayLogo: item.teams.away.logo
        }));
        allMatches = [...allMatches, ...filtered];
      }
    }

    // 3. 통합된 3일치 데이터를 raw-data.json에 저장
    const savePath = path.resolve(__dirname, 'raw-data.json');
    fs.writeFileSync(savePath, JSON.stringify(allMatches, null, 2), 'utf8');

    console.log(`✅ 수집 완료: 총 ${allMatches.length}개의 경기를 확보했습니다.`);
    
  } catch (error) {
    console.error("❌ 수집 오류:", error.message);
  }
}

fetchThreeDaysMatches();