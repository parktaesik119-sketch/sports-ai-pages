import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mistral } from '@mistralai/mistralai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- [ 설정 구역: 여기에 발급받은 키들을 정확히 넣으세요 ] ---
const GEMINI_API_KEYS = [
  "AIzaSyCKAYR5JF7BeW-X_Y8oC0NMzbRgTRitS9I", //7
  "AIzaSyAPA1MdNmovjANGVeSHpF0MCOaeq9X2Sg8", //park
  "AIzaSyDLSSGATYa6iaX_qsYXDNqN5ymUdQgU4KA", //afd
  "AIzaSyDXUL2FTw1FiZkeolOFsEJVtpLxIHyGrKU", //gosang
  "AIzaSyCc823gm7XzEmUQMxio7lBxyqQuwGji_xU", // gogose
  "AIzaSyBqp9a5JeqQx_dxCh1nE7zoZgdZdnlpT20", //pinetree36524
  "AIzaSyDnFenbAwQWCe_rpdtBJz7mUEj3X2pllt0" // gmshan
  
];

const MISTRAL_API_KEY = "ETaoksHjiVDAdtvadjLxpedaMQZuJj0J";

let currentKeyIndex = 0;
let isGeminiExhausted = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MODEL_PRIORITY = [  // 모델 버전 및 수명 주기 확인 요망
 "gemini-2.5-flash",       // 2026-06-17까지 지원 (현재 가장 강력함)
 "gemini-2.5-flash-lite",  // 2026-07-22까지 지원 (가장 수명이 김)
 "gemini-2.5-pro"          // 2026-06-17까지 지원 (Flash가 실패할 경우 대비용)
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
      return league.includes('FOOTBALL') || league.includes('SOCCER') || league.includes('NBA') || 
             league.includes('KBL') || league.includes('V-LEAGUE') || league.includes('KBO') || 
             league.includes('MLB') || league.includes('NHL') || league.includes('LCK') || league.includes('LPL');
    });

    console.log(`🚀 [픽천국 엔진] ${today} 총 ${filteredMatches.length}개 분석 시작 (Gemini -> Mistral 로테이션)`);

    for (let i = 0; i < filteredMatches.length; i++) {
      const match = filteredMatches[i];
      const matchTime = new Date(match.date);
      const now = new Date();
      if (matchTime < now) {
          console.log(`⏩ [스킵] 이미 시작/종료된 경기: ${match.home} vs ${match.away}`);
          continue;
      }
      // 1. 경기 시간을 한국 시간(KST) 객체로 생성
      const matchDateKST = new Date(match.date);

      // 2. dateOnly 생성 (YYYY-MM-DD 형식, 한국 시간 기준)
      // 'sv-SE' 로케일은 YYYY-MM-DD 형식을 기본으로 제공하여 가장 안전합니다.
      const dateOnly = matchDateKST.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

      // 3. dateShort 생성 (26/04/21 형식, 한국 시간 기준)
      const dateShort = matchDateKST.toLocaleDateString('ko-KR', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Seoul'
      }).replace(/\. /g, '/').replace(/\./g, '');

      // 4. 저장 경로 (수정된 dateOnly 사용)
      const savePath = path.resolve(__dirname, `../src/content/posts/${dateOnly}-${match.id}.md`);
      if (fs.existsSync(savePath)) continue; 

      const dateObj = new Date(match.date || new Date());
      const fullKstSchedule = `${dateObj.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })} ${dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

      // 1. 기준 날짜 설정 (2025년 1월 1일 이후 데이터만 취급)
      const strictlyRecentDate = new Date('2025-01-01'); 
      
      // 2. 현재 분석 중인 경기의 날짜 (KST 기준)
      const currentMatchDate = new Date(match.date);

      const h2hHistory = masterData
        .filter(m => {
            const isMatch = ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home));
            
            // [강화된 조건] 
            // 1. 2025년 1월 1일 이후 경기일 것
            // 2. 현재 분석 대상 경기(미래)보다 이전 날짜일 것
            // 3. 결과(score) 데이터가 존재할 것 (비어있는 미래 데이터 제외)
            const matchDate = new Date(m.date);
            const isRecentEnough = matchDate >= strictlyRecentDate;
            const isPast = matchDate < currentMatchDate;
            const hasScore = m.score && m.score.trim() !== "" && m.score !== "-"; 

            return isMatch && isRecentEnough && isPast && hasScore;
        })
        // 최신순으로 정렬 후 상위 5개만 추출
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5); 

      let h2hContent = "";
      if (h2hHistory.length > 0) {
        const h2hRows = h2hHistory.map(h => {
          // 날짜 가독성 좋게 변경 (예: 2025.04.19)
          const d = new Date(h.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '');
          return `| ${d} ${spacer} | ${h.home} ${spacer} | ${h.score} ${spacer} |`;
        }).join('\n');
        
        h2hContent = `\n<br>\n\n### ⚔️ 상대 전적 분석 (2025년 이후)\n| <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">홈팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |\n|:---|:---|:---:|\n${h2hRows}\n`;
      } else {
        h2hContent = "\n\n(최근 2025년 시즌 상대 전적 데이터 없음)\n\n";
      }

      const lg = (match.league || '').toUpperCase();
      console.log("현재 리그:", lg);

      // 🚨 [긴급 차단] 터키 리그 및 특정 잡리그 무조건 스킵
      if (lg.includes('TKBL') || lg.includes('TURKEY') || lg.includes('GELISIM')) {
          console.log(`🚫 [차단] 블랙리스트 리그 발견: ${match.league}`);
          continue;
      }

      let cat = ""; 

      // 1. 농구: 내가 허용할 리그만 정확히 지정
      if (lg.includes('NBA') || lg.includes('KBL') || lg.includes('WKBL') || lg.includes('B.LEAGUE') || lg.includes('CBA') || lg.includes('EUROCUP')) {
        cat = "basketball";
      } 
      // 2. 야구: 허용 리그 지정
      else if (lg.includes('KBO') || lg.includes('MLB') || lg.includes('NPB') || lg.includes('ABL') || lg.includes('CPBL')) {
        cat = "baseball";
      } 
      // 3. 배구: 한국 V-리그 및 주요 리그만
      else if (lg.includes('V-LEAGUE') || lg.includes('KOVO')) {
        cat = "volleyball";
      }
      // 4. 하키: 
      else if (lg.includes('NHL') || lg.includes('KHL')) {
        cat = "hockey";
      }
      // 5. 롤(LoL): 주요 메이저 대회만
      else if (lg.includes('LCK') || lg.includes('LPL') || lg.includes('MSI') || lg.includes('WORLDS') || lg.includes('INTERNATIONAL')) {
        cat = "lol";
      }
      // 6. 축구: 이미 1부 리그 필터가 잘 되어 있음
      else {
          const isFirstDivision = lg.includes('1부') || lg.includes('PREMIER') || lg.includes('DIVISION 1') || lg.includes('SERIE A') || lg.includes('LIGUE 1') || lg.includes('BUNDESLIGA') || lg.includes('LALIGA') || lg.includes('K LEAGUE 1') || lg.includes('MLS') || lg.includes('MAJOR LEAGUE SOCCER');
          if (isFirstDivision) {
              cat = "soccer";
          }
      }

      // 🌟 [결과 체크] 위 조건에 아무것도 해당 안 되면(cat이 비어있으면) 스킵!
      if (!cat) {
          console.log(`⏩ [자동 스킵] 미등록 리그(잡리그): ${match.league}`);
          continue; 
      }
         

      const prompt = `
        너는 '픽천국'의 수석 분석가야. 아래 규정을 절대적으로 준수하여 리포트를 작성해라.

        [금지 사항]
        1. 한자(한문), 일어 사용 절대 금지: 100% 쉬운 한글로만 작성.
        2. 마크다운 코드블록기호(\`\`\`) 사용 금지
        3. 추천픽은 배당은 기재하면 안된다.
        4. 본문에 '(최근 1년 이내 상대 전적 데이터 없음)'이라는 문구가 포함되어 있다면, '### ⚔️ 상대전적' 섹션 자체를 절대로 만들지 마라.
        5. AI 네가 알고 있는 지식 중 2024년 이전의 데이터는 '오래된 데이터'로 간주한다. 이를 최근 전적인 것처럼 속여서 작성하는 행위는 절대 금지한다.
        6. 허용 리그 외 분석 금지

        [디자인 지시]
        1. 항목명은 굵은 글씨와 파란색 강조: '홈팀', '원정팀', '리그', '경기시간', '승무패', '핸디캡', '오버언더', '날짜', '승리팀', '경기결과'는 반드시 <span style="color: #007bff;">항목명</span> 태그 사용.
        2. 부제목 아이콘: 🏟️, ⚔️, 📝, 🎯 필수.
        3. 여백 유지: 표 내부 데이터 뒤에 반드시 ${spacer}를 삽입하여 넓게 벌려라.
        4. 상세 분석(홈/원정/종합분석)은 각각 최소 3문장 이상의 전문적인 문장으로 작성을 하고, 문맥이 끊기거나 주제가 바뀌면 반드시 <br> 태그와 함께 다음 줄로 넘겨라.
        5. 팀명 뒤 'U20', 'W' 등이 있다면 반드시 한글 뒤에 붙여라.(예: W -> 여 이렇게 하지말고 W로 표기) 
        6. 모든 추천픽의 기준점(핸디캡, 오버언더)은 제공된 팀의 전력과 최근 득점력을 바탕으로 네가 직접 '가장 적절한 수치'를 산출해서 [추천 픽 및 기준점] 테이블을 만드세요.(예를 들어 화력전이 예상되면 오버언더 기준점을 2.5 또는 3.5로 네가 직접 정하는 식이다.)
        7. 모든 팀명은 한글로 번역하되, 'TS', 'FC', 'AC', 'SK', 'U20' 같은 영문 약자는 번역하지 말고 영문 그대로 유지해라.(예: TS Galaxy -> TS 갤럭시, FC Barcelona -> FC 바르셀로나)
        8. 그 외 일반적인 팀 이름은 한글 소리 나는 대로 번역해라. (예: Arsenal -> 아스널)
        8. 상대전적은 제공된 데이터(h2hHistory)를 먼저 사용해라. 
        9. 만약 h2hHistory 데이터가 비어 있다면, 너의 실시간 검색 기능을 총동원하여 최근 1년 사이의 두 팀 간 맞대결 기록 3~5개를 반드시 찾아내라.
        10. 2024년 이전의 너무 오래된 데이터만 있다면 차라리 '최근 상대 전적 데이터 부족'이라고 표기하고 분석 섹션을 생략해라. 거짓으로 데이터를 만들지 마라(No Hallucination).
        11. 리그명 중 KBL, MLB, NPB, NHL, MLS, KHL 등 약자로 된 리그는 한글로 바꾸지말고 영문 그대로 사용해주세요.
        12. 축구 리그명 'Major League Soccer'는 'MLS'로 표기 할 것
        13. 분석은 반드시 한국시간으로 오늘 날짜(today)이후(내일과 모레)경기만 분석해주고, 과거 데이터를 오늘 날짜인 것처럼 쓰지 마세요.
        14. NHL은 '미국'의 하키리그이다.
        15. 경기 정보 요약의 글자는 모두 굵은 글씨로 작성해주세요.
        16. 제목과 경기 정보 요약에 팀명과 은 한글 소리나는대로 번역해라.
        17. 출력 시 반드시 최종 분석 보고서 결과만 출력하고, 내부 추론 과정이나 검색 결과에 대한 코멘트, ***나 ### 같은 불필요한 기호, 영어로 된 분석 메모는 절대 포함하지 마세요.
        18. Premier Soccer League는 PL 로 표기할 것.
        19. Challengers League는 CL로 표기할 것.
        
        

      

        [제목 형식 지시] 
        - 분석을 시작하기 전, 첫 번째 줄에 반드시 해당 경기의 국가명을 판단하여 적어라.
          형식: COUNTRY: 국가명 (예: COUNTRY: 남아공, COUNTRY: 짐바브웨)
        - 분석을 시작하기 전, 홈팀과 원정팀의 이름을 바탕으로 해당 경기가 어느 나라 리그인지 판단하여 제목 국가명에 기재해라.(예: COUNTRY: 남아공)
        - 만약 국가를 알기 어렵다면 표기를 생략해라.
        - 형식: TITLE: ${dateShort} 국가명 [리그명] 홈팀명 vs 원정팀명 분석(예시: TITLE: ${dateShort} 미국 [MLS] 몬트리올 CF vs 뉴욕 레드불스 분석)
        - 상단 TITLE 라인에도 반드시 한글 팀명만 사용해라.
        - 날짜는 반드시 ${dateShort} 변수값 그대로 사용할 것. (2026/07/20 처럼 길게 쓰지 말 것)

        TITLE: ${dateShort} [${match.league}] ${match.home} vs ${match.away} 분석

        ### 🏟️ 경기 정보 요약
        | | |
        |:---|:---|
        | **<span style="color: #007bff;">홈팀</span>** ${spacer} | <img src="${match.homeLogo || ''}" width="33" height="30" style="vertical-align: middle;"> ${match.home} |
        | **<span style="color: #007bff;">원정팀</span>** ${spacer} | <img src="${match.awayLogo || ''}" width="33" height="30" style="vertical-align: middle;"> ${match.away} |
        | **<span style="color: #007bff;">리그</span>** ${spacer} | ${match.league} |
        | **<span style="color: #007bff;">경기시간</span>** ${spacer} | ${fullKstSchedule} |

        <br>

        ### <img src="${match.homeLogo || ''}" width="33" height="30" style="vertical-align: middle;">  ${match.home} 분석
        (3문장 이상의 전문 분석. 문단 끝 <br>)

        <br><br>

        ### <img src="${match.awayLogo || ''}" width="33" height="30" style="vertical-align: middle;"> ${match.away} 분석
        (3문장 이상의 전문 분석. 문단 끝 <br>)
        ${h2hContent}
        <br><br>

        ### ⚔️ 상대전적
        (상대전적은 /database/all-fixtures.json 에서 먼저 찾아서 표기하고, 데이터가 없다면 자체적으로 검색하여 최근 5개 경기의 날짜, 승리팀, 경기점수 테이블을 표기)
        (제공된 데이터(h2hContent)에 2024년 기록이 섞여 있더라도 무시하고, 오직 1년전 이후의 기록만 본문에 반영해라.)
        <br><br>

        ### 📝 종합 분석
        (상대전적 유무와 상관없이 현재 폼을 바탕으로 한 최종 진단) 

        <br><br>

        ### 🎯 추천픽
        [추천픽 작성 규칙]
        1. 승무패: '추천' 칸에는 팀명만 적고(예: 은게지 플래티넘), 그 옆의 '-' 칸에 '승', '무', '패' 중 하나를 적어라.
        2. 핸디캡: '추천' 칸에는 팀명만 적어라. 기준점(수치)은 반드시 옆의 '기준점' 칸에만 적어라. 
           (잘못된 예: 은게지 플래티넘 -0.5 / 올바른 예: [추천] 은게지 플래티넘, [기준점] -0.5)
        3. 모든 수치는 소수점 첫째 자리까지 명확히 기재해라.

        | | | | |
        |:---:|:---:|:---:|:---:|
        | **<span style="color: #007bff;">승무패</span>** ${spacer} | (추천) ${spacer} | - ${spacer} |
        | **<span style="color: #007bff;">핸디캡</span>** ${spacer} | (추천) ${spacer} | (AI가 정한 수치) ${spacer} |
        | **<span style="color: #007bff;">오버언더</span>** ${spacer} | (추천) ${spacer} | (AI가 정한 수치) ${spacer} |
        <br><br><br>
      `;

      let success = false;
      if (!isGeminiExhausted) {
        while (!success && currentKeyIndex < GEMINI_API_KEYS.length) {
          const genAI = new GoogleGenerativeAI(GEMINI_API_KEYS[currentKeyIndex]);
          for (const modelName of MODEL_PRIORITY) {
            try {
              const model = genAI.getGenerativeModel({ 
              model: modelName,
              tools: [{ googleSearch: {} }] 
              });
              const result = await model.generateContent(prompt);
              const response = await result.response;
              // leagueName 오류 방지를 위해 savePost 호출
              await savePost(savePath, response.text(), match, dateShort, cat, dateOnly);
              console.log(`✅ [Gemini 키 ${currentKeyIndex + 1}] 성공: ${match.home} vs ${match.away}`);
              success = true;
              break;
            } catch (err) {
              if (err.message.includes("429") || err.message.includes("Quota")) {
                console.warn(`⚠️ [Gemini 키 ${currentKeyIndex + 1}] 할당량 초과. 10초 대기 후 키 교체...`);
                await sleep(10000); // 👈 여기서 잠깐 쉬어줘야 다음 키가 안전합니다.
                currentKeyIndex++;
                break; 
              }
              console.error(`❌ Gemini 모델 오류 (${modelName}):`, err.message);
            }
          }
          if (success) break;
        }
        if (currentKeyIndex >= GEMINI_API_KEYS.length) isGeminiExhausted = true;
      }

      if (!success && MISTRAL_API_KEY) {
        try {
          const client = new Mistral({ apiKey: MISTRAL_API_KEY });
          const chatResponse = await client.chat.complete({
            model: "mistral-small-latest",
            messages: [{ role: 'user', content: prompt }],
          });
          await savePost(savePath, chatResponse.choices[0].message.content, match, dateShort, cat, dateOnly);
          console.log(`💜 [Mistral AI] 성공: ${match.home} vs ${match.away}`);
          success = true;
        } catch (err) {
          console.error(`❌ Mistral 오류: ${err.message}`);
        }
      }

      if (success) await sleep(31000); 
    }
  } catch (error) {
    console.error("❌ 시스템 오류:", error.message);
  }
}

async function savePost(savePath, aiText, match, dateShort, cat, dateOnly) {
  let cleanedText = aiText.replace(/```markdown|```/g, "").trim();

  const cleanTerm = (text) => {
    if (!text) return "";
    return text.replace(/<[^>]*>/g, "").replace(/Women/gi, "W").replace(/\s+/g, " ").trim();
  };

  // 1. 리그명 처리
  let leagueName = cleanTerm(match.league || "스포츠");
  if (leagueName.toUpperCase().includes("MAJOR LEAGUE SOCCER")) leagueName = "MLS";

  // 2. [핵심] AI가 첫 줄에 쓴 COUNTRY 정보 추출
  const countryMatch = cleanedText.match(/COUNTRY:\s*(.*)/);
  let country = countryMatch ? cleanTerm(countryMatch[1]) : "국제";

  // 3. 팀명 추출 (개선된 줄 단위 방식)
  const analysisLines = cleanedText.split('\n')
    .filter(line => line.includes('###') && line.includes('분석'))
    .map(line => cleanTerm(line.replace('###', '').replace('분석', '')));

  let aiHomeName = cleanTerm(match.home);
  let aiAwayName = cleanTerm(match.away);
  if (analysisLines.length >= 2) {
    aiHomeName = analysisLines[0];
    aiAwayName = analysisLines[1];
  }

  if (aiHomeName === aiAwayName) {
    aiHomeName = cleanTerm(match.home);
    aiAwayName = cleanTerm(match.away);
  }

  // 4. [보완] 미국 리그 강제 지정 (MLB 등)
  const usaLeagues = ['MLB', 'NBA', 'NHL', 'MLS', 'WNBA'];
  if (usaLeagues.some(usaLg => leagueName.toUpperCase().includes(usaLg))) {
    country = "미국";
  }

  // 5. 제목 최종 조립 (국가명 포함)
  const finalTitle = `${dateShort} ${country} [${leagueName}] ${aiHomeName} vs ${aiAwayName} 분석`;

  // 6. 본문 정제 (TITLE:, COUNTRY: 라인 모두 삭제)
  cleanedText = cleanedText.replace(/COUNTRY:.*\n?/, "").replace(/TITLE:.*\n?/, "").trim();
  
  // 7. 카테고리 한글 변환 및 푸터 생성
  const catNames = { 
    "soccer": "축구", "basketball": "농구", "baseball": "야구", 
    "volleyball": "배구", "hockey": "하키", "lol": "롤" 
  };
  const korCat = catNames[cat] || "스포츠";

  // savePost 함수 하단, content 만들기 직전 추가
  // 만약 상대전적 섹션 뒤에 내용이 없으면 섹션 자체를 삭제
  cleanedText = cleanedText.replace(/### ⚔️ 상대전적\s*(?:\(최근 1년 이내 상대 전적 데이터 없음\)|최근 상대 전적 데이터가 부족하여.*)?\n/g, ""); 
  cleanedText = cleanedText.replace(/\(최근 1년 이내 상대 전적 데이터 없음\)/g, "");

  const footer = `
<div align="center">
<p><b>© 픽천국(Pick Heaven)</b></p>
<p>- 무료로 배포되는 단순 참고용 분석글이며, 결과에 책임지지 않습니다 -</p>
<hr>
#${aiHomeName.replace(/\s+/g, '')} #${aiAwayName.replace(/\s+/g, '')} #${korCat}분석 #스포츠픽 #픽천국
</div>`;

  const content = `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "${cat}"\n---\n\n${cleanedText}${footer}`;
  
  fs.writeFileSync(savePath, content, 'utf8');
}

analyzeMatches();