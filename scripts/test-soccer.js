const RAPID_KEY = "749bc19777msh67bb1920124b5d7p1cf477jsn772cbb1ccdd3";
const RAPID_HOST = "free-api-live-football-data.p.rapidapi.com";

// 테스트 날짜 설정 (하이픈 없이 YYYYMMDD 형식)
const TEST_DATE = "20260425"; 

async function testRapidSoccer() {
  console.log(`🚀 [${TEST_DATE}] "Free API Live Football Data" 테스트 시작...`);
  
  // 확인된 정확한 엔드포인트 주소
  const url = `https://${RAPID_HOST}/football-get-matches-by-date?date=${TEST_DATE}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': RAPID_KEY,
        'x-rapidapi-host': RAPID_HOST
      }
    });

    const result = await response.json();

    // API 응답 구조 확인 및 데이터 존재 여부 체크
    if (result.status !== "success" || !result.data) {
      console.log("❌ 데이터 수집 실패");
      console.log("응답 전문:", JSON.stringify(result, null, 2));
      return;
    }

    const matches = result.data.allMatches || [];
    
    if (matches.length === 0) {
      console.log("⚠️ 해당 날짜에 검색된 경기가 없습니다.");
      return;
    }

    console.log(`✅ 총 ${matches.length}건의 경기를 찾았습니다.`);
    console.log(`--------------------------------------------------`);

    // 리그별로 경기 수 요약
    const leagueSummary = {};
    matches.forEach(m => {
      const leagueName = m.leagueName || "기타 리그";
      leagueSummary[leagueName] = (leagueSummary[leagueName] || 0) + 1;
    });

    console.log("📌 수집된 리그 요약 (상위 10개):");
    Object.entries(leagueSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([name, count]) => console.log(`- ${name}: ${count}경기`));

    console.log(`--------------------------------------------------`);

    // 샘플 데이터 1건 출력 (데이터 필드 확인용)
    const sample = matches[0];
    console.log("🔍 첫 번째 경기 데이터 샘플:");
    console.log(`- 리그: ${sample.leagueName}`);
    console.log(`- 시간: ${sample.matchTime}`);
    console.log(`- 대진: ${sample.homeName} vs ${sample.awayName}`);
    console.log(`- 스코어: ${sample.homeScore} : ${sample.awayScore}`);

  } catch (error) {
    console.error("❌ 호출 중 에러 발생:", error.message);
  }
}

testRapidSoccer();