import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function analyzeMatches() {
  try {
    // 경로를 scripts 폴더 안의 raw-data.json으로 명확히 고정
    const dataPath = path.resolve(__dirname, 'raw-data.json');
    
    if (!fs.existsSync(dataPath)) {
      throw new Error(`파일을 찾을 수 없습니다: ${dataPath}`);
    }

    const fileContent = fs.readFileSync(dataPath, 'utf8');
    const rawData = JSON.parse(fileContent);

    // 데이터가 비어있는지 체크
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      console.log("⚠️ 현재 raw-data.json 파일에 분석할 데이터가 비어있습니다. 데이터를 먼저 수집해주세요.");
      return;
    }

    const match = rawData[0]; // 이제 안전하게 첫 번째 데이터를 가져옵니다.

    // --- 여기서부터는 사장님이 쓰시던 분석 로직 그대로 유지 ---
    const rawDate = match.date || new Date().toISOString();
    const dateObj = new Date(rawDate);
    const shortYear = dateObj.getFullYear().toString().slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const titleDate = `${shortYear}/${mm}/${dd}`;
    
    const formattedDate = dateObj.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const formattedTime = dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const fullSchedule = `${formattedDate} ${formattedTime}`;

    const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

    // 프롬프트 및 API 호출 로직 (사장님 코드와 동일)
    // ... 중략 ...

    console.log(`✅ 분석 완료: ${titleDate} 경기`);

  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
  }
}
analyzeMatches();