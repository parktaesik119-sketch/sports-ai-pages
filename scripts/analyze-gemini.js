import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 로컬 테스트용 키 직접 입력 (업로드 시 process.env.GROQ_API_KEY로 변경 잊지 마세요!)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function analyzeMatches() {
  try {
    const dataPath = path.resolve(__dirname, 'raw-data.json');
    if (!fs.existsSync(dataPath)) return;

    const fileContent = fs.readFileSync(dataPath, 'utf8');
    const rawData = JSON.parse(fileContent);
    if (!Array.isArray(rawData) || rawData.length === 0) return;

    const match = rawData[0];
    const rawDate = match.time || new Date().toISOString();
    const dateObj = new Date(rawDate);
    const shortYear = dateObj.getFullYear().toString().slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const titleDate = `${shortYear}/${mm}/${dd}`;
    
    const formattedDate = dateObj.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const formattedTime = dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const fullSchedule = `${formattedDate} ${formattedTime}`;

    const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

    const prompt = `
      너는 '픽천국'의 수석 분석가야. 아래 규정을 절대적으로 준수해라.

      [핵심 규정]
      1. **제목 형식**: "TITLE: ${titleDate} [리그명] 홈팀 vs 원정팀 분석" (날짜를 맨 앞으로, 괄호 없이)
      2. **소리 나는 대로 한글화**: 'Campionato Primavera 1' -> '프리마베라 1' 처럼 현지 명칭 사용.
      3. **한자 및 영문 금지**: 100% 한글로만 작성.

      [디자인 지시]
      1. **항목명 파란색**: 표 안의 항목명은 <span style="color: #007bff;">항목명</span> 태그 사용.
      2. **아이콘 필수**: 🏟️, 🏠, 🚌, ⚔️, 📝, 🎯 아이콘 사용.
      3. **태그 정렬**: 글 마지막 태그들은 반드시 <p align="center"> 태그로 감싸서 가운데 정렬해라.

      --- 출력 양식 ---
      TITLE: ${titleDate} [한글리그명] ${match.home} vs ${match.away} 분석

      ### 🏟️ 경기 정보 요약
      | | |
      |:---|:---|
      | **<span style="color: #007bff;">홈팀</span>** ${spacer} | <img src="${match.homeLogo}" width="25" height="25" style="vertical-align: middle;"> ${match.home} |
      | **<span style="color: #007bff;">원정팀</span>** ${spacer} | <img src="${match.awayLogo}" width="25" height="25" style="vertical-align: middle;"> ${match.away} |
      | **<span style="color: #007bff;">리그</span>** ${spacer} | ${match.league} |
      | **<span style="color: #007bff;">경기일정</span>** ${spacer} | ${fullSchedule} |

      <br>

      ### 🏠 ${match.home} 분석
      (전문 분석)

      <br>

      ### 🚌 ${match.away} 분석
      (전문 분석)

      <br>

      ### ⚔️ 상대 전적 분석
      | <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">승리팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |
      |:---|:---|:---:|
      | (날짜) ${spacer} | (한글팀명) ${spacer} | (점수) ${spacer} |

      <br>

      ### 📝 종합 분석
      (핵심 진단)

      <br>

      ### 🎯 추천픽
      | | | | |
      |:---:|:---:|:---:|:---:|
      | **<span style="color: #007bff;">승무패</span>** ${spacer} | ${match.home} 승 ${spacer} | - ${spacer} | **추천** |
      | **<span style="color: #007bff;">핸디캡</span>** ${spacer} | ${match.home} ${spacer} | [값] ${spacer} | **추천** |
      | **<span style="color: #007bff;">오버언더</span>** ${spacer} | [오버/언더] ${spacer} | [기준점] ${spacer} | **추천** |

      <br><br>
      <p align="center">#${match.home} #${match.away} #${match.league} #축구분석 #픽천국</p>
    `;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: "축구 분석 전문가." }, { role: "user", content: prompt }],
        temperature: 0.1 
      })
    });

    const result = await response.json();
    let aiText = result.choices[0].message.content;

    const titleMatch = aiText.match(/TITLE:\s*(.*)/);
    let finalTitle = titleMatch ? titleMatch[1].trim() : `${titleDate} [${match.league}] 분석`;
    aiText = aiText.replace(/TITLE:.*\n?/, "").trim();

    // 하단 워터마크
    aiText += `\n\n---\n<p align="center"><b>© 픽천국(Pick Heaven) - 무단 전재 및 재배포 금지</b></p>`;

    const dateOnly = rawDate.split('T')[0];
    const savePath = path.resolve(__dirname, '../src/content/posts', `${dateOnly}-${match.id}.md`);
    fs.writeFileSync(savePath, `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "soccer"\n---\n\n${aiText}`, 'utf8');

    console.log(`✅ 제목 수정 및 태그 정렬 완료: ${finalTitle}`);
  } catch (error) {
    console.error("❌ 오류:", error.message);
  }
}
analyzeMatches();