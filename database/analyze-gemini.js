import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- [ 설정 구역 ] ---
const GEMINI_API_KEY = "AIzaSyBePzZQYMIc_omUJ6doh_4q0rgGPJO4I1U"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MODEL_PRIORITY = [
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash-lite-001",
  "gemini-pro-latest",
  "gemini-2.5-flash"
];

async function analyzeMatches() {
  try {
    const today = new Date().toISOString().split('T')[0]; 
    const dbPath = path.resolve(__dirname, '../database/all-fixtures.json');
    const dataPath = path.resolve(__dirname, `../database/${today}.json`); 

    if (!fs.existsSync(dataPath)) {
      console.error(`❌ 분석할 ${today}.json 파일을 찾을 수 없습니다.`);
      return;
    }

    const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const masterData = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : [];

    const filteredMatches = rawData.filter(m => {
      const league = (m.league || '').toUpperCase();
      const s = (str) => league.includes(str);
      return s('FOOTBALL') || s('SOCCER') || s('NBA') || s('KBL') || s('V-LEAGUE') || s('KBO') || s('MLB') || s('NHL') || s('LCK') || s('LPL');
    });

    console.log(`🚀 [픽천국 엔진] ${today} 총 ${filteredMatches.length}개 분석 및 디자인 복구 시작`);

    for (let i = 0; i < filteredMatches.length; i++) {
      const match = filteredMatches[i];
      const dateOnly = (match.date || new Date().toISOString()).split('T')[0];
      const dateShort = dateOnly.substring(2).replace(/-/g, '/'); // 26/04/15 형식 
      
      const saveDir = path.resolve(__dirname, '../src/content/posts');
      const savePath = path.join(saveDir, `${dateOnly}-${match.id}.md`);

      if (fs.existsSync(savePath)) continue; 

      // 1. 한국 시간 및 가독성 spacer
      const dateObj = new Date(match.date || new Date());
      const fullKstSchedule = `${dateObj.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })} ${dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

      // 2. 상대 전적 데이터 확보 (데이터가 1개도 없을 경우 섹션 숨김 처리) 
      const h2hHistory = masterData
        .filter(m => ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home)) && new Date(m.date) < new Date(match.date))
        .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5); 

      let h2hContent = "";
      if (h2hHistory.length > 0) {
        const h2hRows = h2hHistory.map(h => `| ${h.date.split('T')[0]} ${spacer} | ${h.home} ${spacer} | ${h.score || '결과 미정'} ${spacer} |`).join('\n');
        h2hContent = `
<br>

### ⚔️ 상대 전적 분석
| <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">승리팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |
|:---|:---|:---:|
${h2hRows}
`;
      }

      // 3. 카테고리 결정
      const lg = (match.league || '').toUpperCase();
      let cat = "soccer"; 
      if (lg.includes('NBA') || lg.includes('KBL')) cat = "basketball";
      else if (lg.includes('KBO') || lg.includes('MLB')) cat = "baseball";
      else if (lg.includes('LCK') || lg.includes('LPL')) cat = "lol";

      const prompt = `
        너는 '픽천국'의 수석 분석가야. 아래 규정을 절대적으로 준수하여 리포트를 작성해라. [cite: 2, 3]

        [금지 사항]
        1. 한자(한문), 일어 사용 절대 금지: 100% 쉬운 한글로만 작성. [cite: 3]
        2. 영문명 사용 금지: 모든 팀명/리그명은 한글로 소리나는 대로 번역.(예: Arsenal -> 아스널) [cite: 4]
        3. 마크다운 기호 노출 주의: 불필요한 코드 블록 기호(\`\`\`) 등을 절대 사용하지 마라. [cite: 4]

        [디자인 지시]
        1. 항목명 파란색 강조: '홈팀', '원정팀', '리그', '경기시간', '승무패', '핸디캡', '오버언더', '날짜', '승리팀', '경기결과'는 반드시 <span style="color: #007bff;">항목명</span> 태그 사용. [cite: 5]
        2. 부제목 아이콘: 🏟️, 🏠, 🚌, ⚔️, 📝, 🎯 필수. [cite: 6]
        3. 여백 유지: 표 내부 데이터 뒤에 반드시 ${spacer}를 삽입하여 넓게 벌려라. [cite: 6]
        4. 상세 분석(홈/원정/종합분석)은 각각 최소 3문장 이상의 전문적인 문장으로 작성을 하고, 문맥이 끊기거나 주제가 바뀌면 반드시 <br> 태그와 함께 다음 줄로 넘겨라. [cite: 7]
        5. 팀명 뒤 'U20', 'W' 등이 있다면 반드시 한글 뒤에 붙여라.(예: W -> 여 이렇게 하지말고 W로) 

        [제목 형식 지시] 
        - 반드시 TITLE: 형식을 유지하며 다음 포맷으로 작성해라.
        - TITLE: ${dateShort} 국가 [리그명] 홈팀명 vs 원정팀명 분석 (국제대회는 국가 대신 '국제'라고 표기)

        TITLE: ${dateShort} [${match.league}] ${match.home} vs ${match.away} 분석

        ### 🏟️ 경기 정보 요약
        | | |
        |:---|:---|
        | **<span style="color: #007bff;">홈팀</span>** ${spacer} | <img src="${match.homeLogo || ''}" width="25" height="25" style="vertical-align: middle;"> ${match.home} |
        | **<span style="color: #007bff;">원정팀</span>** ${spacer} | <img src="${match.awayLogo || ''}" width="25" height="25" style="vertical-align: middle;"> ${match.away} |
        | **<span style="color: #007bff;">리그</span>** ${spacer} | ${match.league} |
        | **<span style="color: #007bff;">경기시간</span>** ${spacer} | ${fullKstSchedule} |

        <br>

        ### 🏠 ${match.home} 분석
        (3문장 이상의 전문 분석. 문단 끝 <br>) [cite: 9]

        <br>

        ### 🚌 ${match.away} 분석
        (3문장 이상의 전문 분석. 문단 끝 <br>) [cite: 10]
        ${h2hContent}
        <br>

        ### 📝 종합 분석
        (상대전적 유무와 상관없이 현재 폼을 바탕으로 한 최종 진단) 

        <br>

        ### 🎯 추천픽 [cite: 12]
        | | | | |
        |:---:|:---:|:---:|:---:|
        | **<span style="color: #007bff;">승무패</span>** ${spacer} | (추천) ${spacer} | - ${spacer} | **추천** |
        | **<span style="color: #007bff;">핸디캡</span>** ${spacer} | (추천) ${spacer} | [0.5] ${spacer} | **추천** |
        | **<span style="color: #007bff;">오버언더</span>** ${spacer} | (추천) ${spacer} | [2.5] ${spacer} | **추천** |
      `;

      let success = false;
      let modelIdx = 0;
      while (!success && modelIdx < MODEL_PRIORITY.length) {
        try {
          const model = genAI.getGenerativeModel({ model: MODEL_PRIORITY[modelIdx] });
          const result = await model.generateContent(prompt);
          const response = await result.response;
          let aiText = response.text().replace(/```markdown|```/g, "").trim();

          const titleMatch = aiText.match(/TITLE:\s*(.*)/);
          let finalTitle = titleMatch ? titleMatch[1].trim() : `${dateShort} [${match.league}] ${match.home} 분석`;
          aiText = aiText.replace(/TITLE:.*\n?/, "").trim();

          // SEO 태그 (한글홈팀, 한글원정팀, 영문홈팀, 영문원정팀, 카테고리분석) [cite: 16]
          // 하단 워터마크 및 구분선 적용 
          const footer = `
<div align="center">
<p><b>© 픽천국(Pick Heaven) - 무단 전재 및 재배포 금지</b></p>
<p>- 무단배포 금지 -</p>
<p>- 무료로 배포되는 단순 참고용 분석글이며, 픽천국은 결과에 책임지지 않습니다 -</p>
<hr>
#${match.home} #${match.away} #${match.home_en || match.home} #${match.away_en || match.away} #${cat}분석 #픽천국
</div>`;

          fs.writeFileSync(savePath, `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "${cat}"\n---\n\n${aiText}\n${footer}`, 'utf8');
          console.log(`✅ 성공: ${finalTitle} (모델: ${MODEL_PRIORITY[modelIdx]})`);
          success = true;
          await sleep(15000); 
        } catch (err) {
          console.error(`❌ ${MODEL_PRIORITY[modelIdx]} 실패, 다음 모델 시도...`);
          modelIdx++;
          await sleep(5000);
        }
      }
    }
  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
  }
}

analyzeMatches();