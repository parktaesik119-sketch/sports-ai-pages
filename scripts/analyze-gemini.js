import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeMatches() {
  try {
    const dataPath = path.resolve(__dirname, 'raw-data.json');
    if (!fs.existsSync(dataPath)) {
      console.error("❌ raw-data.json을 찾을 수 없습니다.");
      return;
    }

    const fileContent = fs.readFileSync(dataPath, 'utf8');
    const rawData = JSON.parse(fileContent);

    // 🏆 사장님 지시 정밀 필터링 (축구 전 리그/국제대회 + 종목별 타겟 국가)
    const filteredMatches = rawData.filter(m => {
      const league = (m.league || '').toUpperCase();
      // 축구: 1/2부, 국제대회, 올림픽, 청소년(U19~23) 포함
      if (league.includes('FOOTBALL') || league.includes('SOCCER') || league.includes('LEAGUE 1') || league.includes('LEAGUE 2') || 
          league.includes('CUP') || league.includes('INTERNATIONAL') || league.includes('FRIENDLIES') || 
          league.includes('OLYMPIC') || league.includes('U19') || league.includes('U20') || league.includes('U21') || league.includes('U23')) return true;
      // 농구: 미, 한, 중, 일
      if (league.includes('NBA') || league.includes('KBL') || league.includes('CBA') || league.includes('B.LEAGUE')) return true;
      // 배구: 한, 일, 중, 터
      if (league.includes('V-LEAGUE') || league.includes('SV.LEAGUE') || league.includes('CVL') || league.includes('SULTANLAR')) return true;
      // 야구: 한, 미, 일, 호, 멕
      if (league.includes('KBO') || league.includes('MLB') || league.includes('NPB') || league.includes('ABL') || league.includes('MEXICAN')) return true;
      // 하키: 미, 러
      if (league.includes('NHL') || league.includes('KHL')) return true;
      // LOL: 한, 미, 중, 국제대회
      if (league.includes('LCK') || league.includes('LCS') || league.includes('LPL') || league.includes('MSI') || league.includes('INTERNATIONAL') || league.includes('WORLD CHAMPIONSHIP')) return true;
      return false;
    });

    console.log(`🚀 [픽천국] 로컬 엔진 가동: 총 ${filteredMatches.length}개 정밀 분석 시작`);

    for (const match of filteredMatches) {
      const rawDate = match.date || match.time || new Date().toISOString();
      const dateOnly = rawDate.split('T')[0];
      const saveDir = path.resolve(__dirname, '../src/content/posts');
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      const savePath = path.join(saveDir, `${dateOnly}-${match.id}.md`);

      if (fs.existsSync(savePath)) continue; 

      const dateObj = new Date(rawDate);
      const titleDate = `${dateObj.getFullYear().toString().slice(-2)}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}`;
      const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";

      const prompt = `
        너는 '픽천국' 수석 분석가다. 아래 규정 어기면 뒤진다.
        1. 한자(漢字), 일본어 절대 금지. 100% 한글로만 작성.
        2. '프리마베라', '캉테라' 등은 유소년으로 번역하지 말고 명칭 그대로 써라.
        3. 항목명 파란색 강조: <span style="color: #007bff;">항목명</span>
        4. 표 모든 행에 반드시 ${spacer} 삽입.

        TITLE: [${match.league}] ${match.home} vs ${match.away} 분석 (${titleDate})

        ### 🏟️ 경기 정보 요약
        | | |
        |:---|:---|
        | **<span style="color: #007bff;">홈팀</span>** ${spacer} | ${match.home} |
        | **<span style="color: #007bff;">원정팀</span>** ${spacer} | ${match.away} |
        | **<span style="color: #007bff;">리그</span>** ${spacer} | ${match.league} |

        <br>
        ### 🏠 ${match.home} 분석
        (최근 흐름 분석)

        <br>
        ### 🚌 ${match.away} 분석
        (최근 흐름 분석)

        <br>
        ### ⚔️ 상대 전적 분석 (최근 5경기)
        | <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">승리팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |
        |:---|:---|:---:|
        | (데이터1) ${spacer} | (데이터) ${spacer} | (결과) ${spacer} |
        | (데이터2) ${spacer} | (데이터) ${spacer} | (결과) ${spacer} |
        | (데이터3) ${spacer} | (데이터) ${spacer} | (결과) ${spacer} |
        | (데이터4) ${spacer} | (데이터) ${spacer} | (결과) ${spacer} |
        | (데이터5) ${spacer} | (데이터) ${spacer} | (결과) ${spacer} |

        <br>
        ### 📝 종합 분석 및 추천
        (종합 진단)

        <br>
        ### 🎯 추천픽
        | | | | |
        |:---:|:---:|:---:|:---:|
        | **<span style="color: #007bff;">승무패</span>** ${spacer} | 추천 ${spacer} | - ${spacer} | **추천** |
        | **<span style="color: #007bff;">핸디캡</span>** ${spacer} | 추천 ${spacer} | [값] ${spacer} | **추천** |
        | **<span style="color: #007bff;">오버언더</span>** ${spacer} | 추천 ${spacer} | [기준] ${spacer} | **추천** |
      `;

      try {
        console.log(`📝 로컬 분석 중: [${match.league}] ${match.home} vs ${match.away}`);
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          body: JSON.stringify({
            model: "tinydolphin", // 사장님이 성공시킨 모델
            prompt: prompt,
            stream: false,
            options: { temperature: 0.1 }
          })
        });

        const result = await response.json();
        let aiText = result.response;

        const titleMatch = aiText.match(/TITLE:\s*(.*)/);
        let finalTitle = titleMatch ? titleMatch[1].trim() : `[${match.league}] ${match.home} 분석`;
        aiText = aiText.replace(/TITLE:.*\n?/, "").trim();

        // 워터마크 추가
        aiText += `\n\n---\n<p align="center"><b>© 픽천국(Pick Heaven) - 무단 전재 및 재배포 금지</b></p>`;

        fs.writeFileSync(savePath, `---\ntitle: "${finalTitle}"\ndate: ${new Date().toISOString()}\nslug: "analyze-${match.id}-${dateOnly}"\ncategory: "sports"\n---\n\n${aiText}`, 'utf8');
        console.log(`✅ 파일 생성 완료: ${finalTitle}`);
      } catch (error) { console.error(`❌ 에러: ${error.message}`); }
    }
  } catch (error) { console.error("❌ 오류:", error.message); }
}
analyzeMatches();