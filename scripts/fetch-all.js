import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- [ 사장님 설정 ] ---
const API_SPORTS_KEY = "8e49b25e545ea6bff12f75a858c89529";
const ODDS_API_KEY = "3d7903bd16bdc5cd23fea5cd05a23692";
const PANDASCORE_KEY = "GfxE_2NtG9NN2bI-TW2NobkbeSXIFNLleuR5M4Nz6kgRHs9zxnY";

const SPORTS_CONFIG = {
  soccer: "v3.football.api-sports.io",
  basketball: "v1.basketball.api-sports.io",
  baseball: "v1.baseball.api-sports.io",
  volleyball: "v1.volleyball.api-sports.io",
  hockey: "v1.hockey.api-sports.io"
};

const DB_DIR = path.resolve(__dirname, '../database');
const MASTER_DB_PATH = path.join(DB_DIR, 'all-fixtures.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

async function fetchAllData() {
  try {
    let dailyMatches = [];
    const today = new Date().toISOString().split('T')[0];

    // 1. 데이터 수집 (오늘~모레 3일치)
    const dates = [0, 1, 2].map(offset => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    });

    for (const date of dates) {
      for (const [sport, host] of Object.entries(SPORTS_CONFIG)) {
        const response = await fetch(`https://${host}/fixtures?date=${date}&timezone=Asia/Seoul`, {
          headers: { "x-rapidapi-key": API_SPORTS_KEY, "x-rapidapi-host": host }
        });
        const result = await response.json();
        if (result.response) {
          const formatted = result.response.map(item => ({
            id: item.id || item.fixture?.id,
            sport,
            league: item.league.name,
            date: item.date || item.fixture?.date,
            home: item.teams.home.name,
            away: item.teams.away.name,
            homeLogo: item.teams.home.logo,
            awayLogo: item.teams.away.logo
          }));
          dailyMatches = [...dailyMatches, ...formatted];
        }
      }
    }

    // 2. 날짜별 원본 파일 저장 (예: 2026-04-15.json)
    fs.writeFileSync(path.join(DB_DIR, `${today}.json`), JSON.stringify(dailyMatches, null, 2));

    // 3. 마스터 DB (all-fixtures.json) 누적 및 중복 제거
    let masterData = [];
    if (fs.existsSync(MASTER_DB_PATH)) {
      masterData = JSON.parse(fs.readFileSync(MASTER_DB_PATH, 'utf8'));
    }

    const updatedMaster = [...masterData, ...dailyMatches].reduce((acc, current) => {
      if (!acc.find(item => item.id === current.id)) acc.push(current);
      return acc;
    }, []);

    fs.writeFileSync(MASTER_DB_PATH, JSON.stringify(updatedMaster, null, 2));
    console.log(`✅ 수집 완료: 오늘자 저장 및 마스터 DB(${updatedMaster.length}건) 업데이트 완료`);

  } catch (error) {
    console.error("❌ 오류:", error.message);
  }
}
fetchAllData();