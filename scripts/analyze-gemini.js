import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeMatches() {
  try {
    // 1. 마스터 DB 및 오늘 데이터 로드
    const dbPath = path.resolve(__dirname, '../database/all-fixtures.json');
    const dataPath = path.resolve(__dirname, 'raw-data.json'); 

    if (!fs.existsSync(dataPath)) {
      console.error("❌ 분석할 raw-data.json을 찾을 수 없습니다.");
      return;
    }

    const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const masterData = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : [];

    // 2. [사장님 로직 100% 보존] 정밀 필터링 (축구, 농구, 야구, 배구, 하키, LOL)
    const filteredMatches = rawData.filter(m => {
      const league = (m.league || '').toUpperCase();
      if (league.includes('FOOTBALL') || league.includes('SOCCER') || league.includes('LEAGUE 1') || league.includes('LEAGUE 2') || 
          league.includes('CUP') || league.includes('INTERNATIONAL') || league.includes('FRIENDLIES') || 
          league.includes('OLYMPIC') || league.includes('U19') || league.includes('U20') || league.includes('U21') || league.includes('U23')) return true;
      if (league.includes('NBA') || league.includes('KBL') || league.includes('CBA') || league.includes('B.LEAGUE')) return true;
      if (league.includes('V-LEAGUE') || league.includes('SV.LEAGUE') || league.includes('CVL') || league.includes('SULTANLAR')) return true;
      if (league.includes('KBO') || league.includes('MLB') || league.includes('NPB') || league.includes('ABL') || league.includes('MEXICAN')) return true;
      if (league.includes('NHL') || league.includes('KHL')) return true;
      if (league.includes('LCK') || league.includes('LCS') || league.includes('LPL') || league.includes('MSI') || league.includes('WORLD CHAMPIONSHIP')) return true;
      return false;
    });

    console.log(`🚀 [픽천국] 분석 엔진 가동: 총 ${filteredMatches.length}개 경기 정밀 분석 시작`);

    for (const match of filteredMatches) {
      const rawDate = match.date || new Date().toISOString();
      const dateOnly = rawDate.split('T')[0];
      const saveDir = path.resolve(__dirname, '../src/content/posts');
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      const savePath = path.join(saveDir, `${dateOnly}-${match.id}.md`);

      // 중복 생성 방지
      if (fs.existsSync(savePath)) continue; 

      // 3. [사장님 로직 100% 보존] 마스터 DB에서 실제 상대 전적(H2H) 추출
      const h2hHistory = masterData
        .filter(m => 
          ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home)) &&
          new Date(m.date) < new Date(match.date)
        )
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5); 

      const h2hDataText = h2hHistory.length > 0 
        ? h2hHistory.map(h => `| ${h.date.split('T')[0]} | ${h.home} vs ${h.away} | 결과 정보 포함 |`).join('\n')
        : "| 데이터 없음 | 최근 상대 전적 데이터가 부족합니다. | - |";

      // 4. [사장님 로직 100% 보존] 종목별 카테고리 정밀 분류
      const lg = (match.league || '').toUpperCase();
      let finalCategory = "soccer"; 
      if (lg.includes('NBA') || lg.includes('KBL') || lg.includes('CBA') || lg.includes('B.LEAGUE')) finalCategory = "basketball";
      else if (lg.includes('KBO') || lg.includes('MLB') || lg.includes('NPB') || lg.includes('ABL')) finalCategory = "baseball";
      else if (lg.includes('V-LEAGUE') || lg.includes('SV.LEAGUE') || lg.includes('SULTANLAR')) finalCategory = "volleyball";
      else if (lg.includes('NHL') || lg.includes('KHL')) finalCategory = "hockey";
      else if (lg.includes('LCK') || lg.includes('LCS') || lg.includes('LPL') || lg.includes('WORLD')) finalCategory = "lol";

      const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
      
      // 5. 🤖 llama3:8b 모델에 최적화된 한국어 특화 프롬프트
      const prompt = `
        당신은 대한민국 최고의 스포츠 분석 채널 '픽천국'의 수석 에디터입니다.
        아래 경기 정보를 바탕으로 반드시 **한국어로만** 가독성이 뛰어난 전문 분석글을 작성하세요.

        [지시 사항]
        1. 모든 영어 팀명과 리그명은 자연스러운 한국어로 번역하세요. (예: Arsenal -> 아스널)
        2. 분석 내용은 각 팀당 최소 3문장 이상 상세하고 전문적으로 작성하세요.
        3. 항목 제목은 파란색 강조 태그 <span style="color: #007bff;">항목명</span>를 사용하세요.
        4. TITLE 형식: TITLE: [한글리그명] 한글홈팀 vs 한글원정팀 분석 (날짜)

        원문 데이터:
        - 리그: ${match.league}
        - 홈팀: ${match.home} / 원정팀: ${match.away}
        - 상대전적: ${h2hDataText}

        [출력 구조]
        TITLE: [한글리그명] ${match.home} vs ${match.away} 분석 (${dateOnly})

        ### 🏟️ 경기 정보 요약
        | | |
        |:---|:---|
        | **<span style="color: #007bff;">홈팀</span>** ${spacer} | (한글 홈팀명 번역) |
        | **<span style="color: #007bff;">원정팀</span>** ${spacer} | (한글 원정팀명 번역) |
        | **<span style="color: #007bff;">리그</span>** ${spacer} | (한글 리그명 번역) |

        <br>
        ### 🏠 (한글홈팀명) 상세 분석
        (이 팀의 최근 폼과 핵심 선수 위주 분석 서술)

        <br>
        ### 🚌 (한글원정팀명) 상세 분석
        (원정 팀의 수비력과 최근 원정 경기 흐름 분석 서술)

        <br>
        ### ⚔️ 상대 전적 분석 (최근 5경기)
        ${h2hDataText}

        <br>
        ### 📝 종합 분석 및 최종 진단
        (상대 전적과 두 팀의 현재 기세를 비교하여 최종 시나리오 서술)

        <br>
        ### 🎯 최종 추천픽
        | | | | |
        |:---:|:---:|:---:|:---:|
        | **<span style="color: #007bff;">승무패</span>** ${spacer} | 추천결과 | - | **추천** |
        | **<span style="color: #007bff;">핸디캡</span>** ${spacer} | 추천결과 | [기준점] | **추천** |
        | **<span style="color: #007bff;">오버언더</span>** ${spacer} | 추천결과 | [기준점] | **추천** |
      `;

      // 6. Ollama 분석 실행 (설치 중이신 llama3:8b 모델 사용)
      try {
        console.log(`📝 분석 생성 중: ${match.home} vs ${match.away}`);
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          body: JSON.stringify({ 
            model: "llama3:8b", // 설치 중인 모델명으로 변경
            prompt: prompt, 
            stream: false,
            options: { temperature: 0.3, num_predict: 2000 }
          })
        });

        const result = await response.json();
        let aiText = result.response;

        // 제목 추출 및 메타데이터 정리
        const titleMatch = aiText.match(/TITLE:\s*(.*)/);
        let finalTitle = titleMatch ? titleMatch[1].trim() : `[${match.league}] ${match.home} vs ${match.away} 분석`;
        aiText = aiText.replace(/TITLE:.*\n?/, "").trim();
        aiText += `\n\n---\n<p align="center"><b>© 픽천국(Pick Heaven) - 무단 전재 및 재배포 금지</b></p>`;

        fs.writeFileSync(savePath, `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "${finalCategory}"\n---\n\n${aiText}`, 'utf8');
        console.log(`✅ 생성 완료: ${savePath}`);
      } catch (err) { console.error(`❌ AI 호출 오류: ${err.message}`); }
    }
  } catch (error) { console.error("❌ 분석 오류:", error.message); }
}
analyzeMatches();