import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROQ_API_KEY = "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";

async function analyzeMatches() {
  try {
    const dataPath = path.join(__dirname, 'raw-data.json');
    const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const match = rawData[0];

    // 제목용 날짜 포맷 (26/04/14)
    const rawDate = match.date || new Date().toISOString();
    const dateObj = new Date(rawDate);
    const shortYear = dateObj.getFullYear().toString().slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const titleDate = `${shortYear}/${mm}/${dd}`;

    // 본문용 일정 포맷
    const formattedDate = dateObj.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const formattedTime = dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const fullSchedule = `${formattedDate} ${formattedTime}`;

    // 사장님 전용 강력 여백
    const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

    const prompt = `
      너는 '픽천국'의 수석 분석가야. 아래 규정을 '절대적으로' 준수하여 분석글을 작성해라.

      [금지 사항 - 위반 시 해고]
      1. **한자(한문) 사용 절대 금지**: 본문 전체에서 단 한 글자의 한자도 사용하지 마라. 모든 단어는 쉬운 한글로만 작성해라. (예: 採用 -> 채용, 混亂 -> 혼란)
      2. **영문명 사용 금지**: 팀명과 리그명은 반드시 한글로만 작성해라.

      [데이터 준수]
      1. **리그**: ${match.league} (예: Campionato Primavera 1 -> 프리마베라 1)
      2. **홈팀**: ${match.home} (예: Milan U20 -> 밀란 U20) - 'U20'은 한글 뒤에 반드시 붙여라.
      3. **원정팀**: ${match.away} (예: Atalanta U20 -> 아탈란타 U20) - 'U20'은 한글 뒤에 반드시 붙여라.

      [디자인 지시]
      1. **제목**: "TITLE: ${titleDate} [리그명] 홈팀 vs 원정팀 분석"
      2. **로고**: <img src="URL" width="25" height="25" style="vertical-align: middle; object-fit: contain; margin-right: 5px;"> 사용.
      3. **여백**: 표의 첫 번째 항목 뒤에 반드시 '${spacer}' 삽입.

      --- 출력 양식 ---
      TITLE: ${titleDate} [한글리그명] 한글홈팀 vs 한글원정팀 분석

      ### 🏟️ 경기 정보 요약
      | | |
      |:---|:---|
      | **홈팀** ${spacer} | <img src="${match.homeLogo}" width="25" height="25" style="vertical-align: middle; object-fit: contain; margin-right: 5px;"> 한글홈팀 |
      | **원정팀** ${spacer} | <img src="${match.awayLogo}" width="25" height="25" style="vertical-align: middle; object-fit: contain; margin-right: 5px;"> 한글원정팀 |
      | **리그** ${spacer} | 한글리그명 |
      | **경기일정** ${spacer} | ${fullSchedule} |

      <br>

      ### 🏠 한글홈팀 분석
      (100% 한글로만 작성된 전문 분석)

      <br>

      ### 🚌 한글원정팀 분석
      (100% 한글로만 작성된 전문 분석)

      <br>

      ### ⚔️ 상대 전적 분석
      | 날짜 ${spacer} | 승리팀 ${spacer} | 경기결과 |
      |:---|:---|:---:|
      | (날짜) | (한글팀명) | (점수) |

      <br>

      ### 📝 종합 분석
      (100% 한글로만 작성된 핵심 진단)

      <br>

      ### 🎯 추천픽
      | | | | |
      |:---:|:---:|:---:|:---:|
      | **승무패** ${spacer} | 한글홈팀 승 ${spacer} | - ${spacer} | **추천** |
      | **핸디캡** ${spacer} | 한글홈팀 ${spacer} | [값] ${spacer} | **추천** |
      | **오버언더** ${spacer} | [오버/언더] ${spacer} | [2.5] ${spacer} | **추천** |
    `;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1 
      })
    });

    const result = await response.json();
    let aiText = result.choices[0].message.content;

    const titleMatch = aiText.match(/TITLE:\s*(.*)/);
    let finalTitle = titleMatch ? titleMatch[1].trim() : `${titleDate} 분석`;
    finalTitle = finalTitle.replace(/"/g, "'"); 

    aiText = aiText.replace(/TITLE:.*\n?/, "").trim();

    const dateOnly = rawDate.split('T')[0];
    const savePath = path.resolve(__dirname, '../src/content/posts', `${dateOnly}-${match.id}.md`);

    const finalContent = `---
title: "${finalTitle}"
date: ${new Date().toISOString()}
slug: "analyze-${match.id}-${dateOnly}"
category: "soccer"
---

${aiText}`;

    fs.writeFileSync(savePath, finalContent, 'utf8');
    console.log(`✅ 한자 완전 제거 및 명칭 복구 완료: ${finalTitle}`);

  } catch (error) {
    console.error("❌ 오류:", error.message);
  }
}
analyzeMatches();