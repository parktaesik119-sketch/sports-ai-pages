import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES 모듈에서 경로 설정을 위한 코드
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 설정 정보
const API_KEY = '8e49b25e545ea6bff12f75a858c89529';
const BASE_URL = 'https://v3.football.api-sports.io';

async function getMatches(date) {
  try {
    const response = await axios.get(`${BASE_URL}/fixtures`, {
      params: { 
        date: date,
        timezone: 'Asia/Seoul' // 한국 시간 기준으로 가져오기
      },
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    });

    const matches = response.data.response;
    
    if (!matches || matches.length === 0) {
      console.log(`${date} 일자에 경기 데이터가 없습니다.`);
      return;
    }

    console.log(`${date} 일자에 총 ${matches.length}개의 경기가 있습니다.`);

    // 실제 분석에 필요한 데이터만 뽑기
    const selectedMatches = matches.slice(0, 5).map(m => ({
      id: m.fixture.id,
      league: m.league.name,
      round: m.league.round,
      home: m.teams.home.name,
      away: m.teams.away.name,
      homeLogo: m.teams.home.logo,
      awayLogo: m.teams.away.logo,
      time: m.fixture.date,
      venue: m.fixture.venue.name
    }));

    // 파일 저장 경로 설정 (scripts 폴더 안에 raw-data.json으로 저장)
    const savePath = path.join(__dirname, 'raw-data.json');
    fs.writeFileSync(savePath, JSON.stringify(selectedMatches, null, 2));
    
    console.log(`✅ 데이터 수집 완료!`);
    console.log(`📂 저장 위치: ${savePath}`);

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
  }
}

const today = new Date().toISOString().split('T')[0];
getMatches(today);