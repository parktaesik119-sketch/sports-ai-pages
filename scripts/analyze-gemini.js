import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function analyzeMatches() {
  try {
    const dataPath = path.resolve(__dirname, 'raw-data.json');
    
    // [안전장치 1] 파일 존재 여부 확인
    if (!fs.existsSync(dataPath)) {
      console.log("⚠️ raw-data.json 파일이 없습니다. fetch-football.js를 먼저 실행하세요.");
      return;
    }

    const fileContent = fs.readFileSync(dataPath, 'utf8');
    const rawData = JSON.parse(fileContent);

    // [안전장치 2] 데이터가 비어있는지 확인 (에러 방지 핵심)
    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.log("⚠️ 분석할 경기 데이터가 비어있습니다.");
      return;
    }

    // 안전하게 첫 번째 경기 데이터 추출
    const match = rawData[0];

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

    const prompt = `
      너는 '픽천국'의 수석 분석가야. 아래 규정을 준수하여 리포트를 작성해라.

      [핵심 금지 사항]
      1. 한자(한문) 절대 사용 금지: 100% 쉬운 한글로만 작성.
      2. 영문명 사용 금지: 팀명, 리그명은 반드시 한글로 번역.

      [디자인 및 SEO 지시]
      1. 기준점 유동화: 오버언더 기준점(예: 2.5, 3.5 등)은 데이터에 맞게 직접 입력해라.
      2. 모바일 최적화: 추천픽 표 내부에 여백(${spacer})을 넣지 마라.
      3. **SEO 해시태그**: 글 맨 마지막에 해당 경기와 관련된 해시태그 5개를 '#팀명 #리그명 #축구분석' 형식으로 반드시 추가해라.

      --- 출력 양식 ---
      TITLE: ${titleDate} [한글리그명] ${match.home} vs ${match.away} 분석

      ### 🏟️ 경기 정보 요약
      | | |
      |:---|:---|
      | **홈팀** ${spacer} | <img src="${match.homeLogo}" width="25" height="25" style="vertical-align: middle; object-fit: contain; margin-right: 5px;"> ${match.home} |
      | **원정팀** ${spacer} | <img src="${match.awayLogo}" width="25" height="25" style="vertical-align: middle; object-fit: contain; margin-right: 5px;"> ${match.away} |
      | **리그** ${spacer} | [${match.league}] |
      | **경기일정** ${spacer} | ${fullSchedule} |

      <br><br>

      ### 🏠 ${match.home} 분석
      (분석 내용)

      <br><br>

      ### 🚌 ${match.away} 분석
      (분석 내용)

      <br><br>

      ### 📝 종합 분석
      (내용)

      <br><br>

      ### 🎯 추천픽
      | 구분 | 선택 | 추천 |
      |:---|:---|:---|
      | **승무패** | ${match.home} 승 | **추천** |
      | **핸디캡** | ${match.home} [핸디값] | **추천** |
      | **오버언더** | [오버/언더] [기준점] | **추천** |

      <br><br>
      (여기에 해시태그 위치)
    `;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "한자를 절대 쓰지 않는 축구 분석가다." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1 
      })
    });

    const result = await response.json();
    let aiText = result.choices[0].message.content;

    const titleMatch = aiText.match(/TITLE:\s*(.*)/);
    let finalTitle = titleMatch ? titleMatch[1].trim() : `${titleDate} 분석`;
    finalTitle = finalTitle.replace(/"/g, "'"); 
    aiText = aiText.replace(/TITLE:.*\n?/, "").trim();

    // 워터마크 추가
    aiText += `\n\n---\n<p align="center"><b>© 픽천국(Pick Heaven) - 무단 전재 및 재배포 금지</b></p>`;

    const dateOnly = rawDate.split('T')[0];
    const savePath = path.resolve(__dirname, '../src/content/posts', `${dateOnly}-${match.id}.md`);
    fs.writeFileSync(savePath, `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "soccer"\n---\n\n${aiText}`, 'utf8');

    console.log(`✅ SEO 태그 포함 분석 완료: ${finalTitle}`);

  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
  }
}
analyzeMatches();