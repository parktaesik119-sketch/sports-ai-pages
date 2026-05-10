import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mistral } from '@mistralai/mistralai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 깃허브 시크릿에서 키를 가져와 배열로 만듬.
const GEMINI_API_KEYS = process.env.GEMINI_KEYS 
  ? process.env.GEMINI_KEYS.split(',').map(key => key.trim()) 
  : [];

const MISTRAL_API_KEYS = process.env.MISTRAL_KEYS 
  ? process.env.MISTRAL_KEYS.split(',').map(key => key.trim()) 
  : [];

// 키가 없을 경우 실행을 중단하는 안전장치 추가
if (GEMINI_API_KEYS.length === 0) {
  console.error("❌ 오류: GEMINI_KEYS 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

// [추가] 특정 팀명을 원하는 이름으로 고정하는 매핑 테이블
const TEAM_NAME_MAP = {
  "KFUM oslo": "KFUM 오슬로",
  "Manchester City": "맨시티",
  "Tottenham": "토트넘",
  "Bodo/Glimt": "보되/글림트",
  "Al-Ettifaq": "알 에티파크",
  "Genk": "헹크",
  "Auxerre": "옥세르",
  // 필요한 팀명을 여기에 계속 추가하세요. "원래이름": "바꿀이름"
};

// [추가] 팀명을 파일명 규칙(하이픈, 마침표 제거)으로 변환하는 함수
function getSafeLogoName(teamName) {
  if (!teamName) return "default-logo";
  return teamName
    .toLowerCase()
    .replace(/[\/\\]/g, '-')     // 1. 슬래시부터 먼저 대시로 바꿔서 경로 분리 방지
    .replace(/\./g, "-")        // 2. 점(.) 처리
    .replace(/\s+/g, "-")       // 3. 빈칸 처리
    .replace(/[^a-z0-9-]/g, '')  // 4. 나머지 특수문자 싹 다 제거 (안전빵)
    .replace(/-+/g, "-")        // 5. 중복 대시 정리
    .replace(/^-+|-+$/g, '');   // 6. 앞뒤 정리
}

let currentKeyIndex = 0;          // Gemini 키 인덱스
let currentMistralKeyIndex = 0;   // [추가] Mistral 키 인덱스
let isGeminiExhausted = false;    // Gemini 소진 여부
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MODEL_PRIORITY = [  // 모델 버전 및 수명 주기 확인 요망
  "gemini-2.5-flash",          // 2026년 10월까지 유효
  "gemini-2.5-flash-lite",     // 2026년 10월까지 유효
  "gemini-2.5-pro",            // 2026년 10월까지 유효
  "gemini-3-flash-preview",    // 최신 권장 모델
  "gemini-3.1-flash-lite",     // 최신 권장 모델 (표의 권장 교체 참고)
  "gemini-3.1-pro-preview"     // 최신 권장 모델
 
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
    

    const blockedLeagues = [  //대소문자 구분없음
   // 성별 및 연령대 (Youth & Gender)
  'U21', 'U19', 'U18', 'U17', 'YOUTH', 'RESERVE', 'WOMEN', 'WOMAN', 'FEMALE', 'FRAUEN', 'FEMININE', 'FEMININE DIVISION 1', 'Femenil',
    // 하부 리그 명칭 (Lower Divisions)
  'LIGUE 2', 'LIGA 2', 'SERIE B', 'SERIE C', 'SERIE D', '3. LIGA', 'REGIONALLIGA', 'LEAGUE TWO', 'NATIONAL LEAGUE', 'NATIONAL', 'CHAMPIONNAT', 'EERSTE', 'EXPANSION', 'NACIONAL', 'METROPOLITANA', 'PRIMERA B', 'FEDERAL A',
  'SEGUNDA DIVISIÓN RFEF', 'TERCERA DIVISION', 'OBERLIGA', 'REGION', 'NON LEAGUE PREMIER - NORTHERN', 'NON LEAGUE PREMIER - SOUTHERN SOUTH', 'ISTHMIAN', 'LOWLAND', 'HIGHLAND', 'SOUTHERN', 'CENTRAL', 'NON',
    // 아시아 리그 (Asia)
  'K4','J2/J3 League','FOOTBALL LEAGUE', 'THAILAND', 'MALAYSIA', 'INDONESIA', 'Two', 'Birinci', 'Tasmania Northern Championship', 'Southern Championship', 'Queensland Premier League', 'V.League 2', 'Liga 2', 'I-League',
    // 브라질 및 남미 컵대회/지역리그 (South America & Cups)
  'CAMPEONATO', 'COPA DO NORDESTE', 'COPA VERDE', 'COPA ESPÍRITO SANTO', 'COPA CENTRO-OESTE', 'COPA SUL-SUDESTE', 'COPA NORTE', 'PAULISTA', 'CARIOCA', 'MINEIRO', 'GAUCHO', 'PARANAENSE', 'BAIANO', 'PERNAMBUCANO', 'CATARINENSE', 'Copa do Nordeste', 'Copa Norte', 'Copa Presidente', 'Centro-Oeste', 'Copa Centro-Oeste', 'Copa Sul-Sudeste', 'Sul-Sudeste',
  'GOIANO', 'CEARENSE','LIGA PRO SERIE B', 'Liga Pro Serie B', 'Primera B', 'Sudamericana', 'Copa De La Liga', 'Serie B', 'Copa Do Brasil', 'Expansion MX', 'Copa Espírito Santo', 'Santo',
    // 아프리카 및 기타 국가 (Africa & Others)
  'EGYPT', 'SOUTH AFRICA', 'TUNISIA', 'MOROCCO', 'UGANDA', 'BOTOLA', 'Elite Two',
    // 유럽 기타 국가 및 리그 (Europe Others)
  '1. DIVISION', 'FEDERACION', 'SUPER LEAGUE 2', '2. Deild', '3. Division', '3. Division - Girone 6', 'UEFA Europa Conference League', 'Ykkösliiga', 'Kakkonen - Lohko C', 'Kakkonen - Lohko A', 'Kakkonen - Lohko B', 'Kakkonen', 'Superettan', 'Ettan - Södra', 'Ettan - Norra', 'Ettan', 'Division 2 - Norra Götaland', 'Division 2 - Östra Götaland', 'Götaland', 'Division 2 - Västra Götaland', 'Damallsvenskan', 'Division 2 - Norrland', 'First Division',
  'U18 PREMIER LEAGUE', 'PREMIER LEAGUE INTERNATIONAL CUP', 'Elitettan', 'Damallsvenskan', 'Ettan', 'Svealand', 'Prime League', 'North American', 'NWSL', 'Central', 'MLS Next Pro',
    // 농구 및 기타 (Basketball & Others)
  'WNBA', 'NBAW', 'NBA W', 'W NBA', 'ABA LEAGUE', 'USL CHAMPIONSHIP', 'BAHRAIN', 'Balkan', 'HLL', 'LES', 'Circuito', 'LRS', 'Legends',  'ACB', 'NBL', 'USHL', 'SHL', 'Liiga', 'DEL', 'SuperLega', 'PlusLiga', 'LFL', 'Prime League', 'Arabian League', 'TCL', 'Regular', 'LIT', 'BSN', 'LNB', 'LBP', 'PCL', 'SPHL', 'ECHL', 'Regular Season',
];

  // ⬇️ 제외하고 싶은 국가명을 정확히 입력하세요 //대소문자 구분없음
    const blockedCountries = [
  "Bahrain", "Kyrgyzstan", "Uzbekistan", "Uganda", "Eswatini", "Zambia", "Algeria", "India", "South-Africa", "Malaysia", "Malta", "Kenya", "Barbados", "Peru", "Bolivia", "Honduras", "Cambodia", "Ivory-Coast", "Cyprus", "Burkina-Faso", "Azerbaijan", "Belarus", "Kazakhstan", "Ukraine", "Zimbabwe", "Rwanda", "Congo", "Mongolia", "Armenia", "Indonesia", "Syria", "Ethiopia", "Chile", "Ecuador", "Lithuania", "Mauritania", "Latvia", "Estonia", "Balkans", "Puerto Rico", "Dominican Republic", "Aruba", "Philippines", 'PERU', 'ECUADOR', 'AZERBAIJAN', 'ARMENIA', 'BELARUS', 'KAZAKHSTAN', 'UKRAINE', 'ICELAND', 'LITHUANIA', 'LATVIA', 'ESTONIA', 'MALTA', 'CYPRUS', 'SYRIA', 'BARBADOS', 'Bangladesh', 'Egypt', 'Tunisia', 'Malawi', 'Ghana',
  "Slovakia", "Faroe-Islands", 'Aruba', 'Panama', 'Bhutan', 'Ethiopia', 'Congo-DR', 'Israel', "El Salvador", 'El-Salvador', 'Jamaica', 'Rwanda', 'Mauritania', 'Zimbabwe',,'Ethiopia', 'Kenya', 'Algeria','INDIA', 'UZBEKISTAN', 'KYRGYZSTAN', 'Bangladesh', 'Lesotho',
].filter(c => c !== "South-Korea");

    const blockedTeams = [
  // [나이,성별]
  'U21', 'U19', 'U18', 'U17', 'YOUTH', 'RESERVE', 'WOMEN', 'WOMAN', 'FEMALE', 'FRAUEN', 'FEMININE', 'FEMININE DIVISION 1', 'Femenil', 'Bubliki', 'ZeroZone Gaming', 'Ronaldo Team', 'The Otter Side', 'Crusaders', 'Dream Esports', 'GTZ Esports',
  ];
   
  const filteredMatches = rawData.filter(m => {
  const lg = (m.league || '').trim(); 
  const upperLg = lg.toUpperCase(); // 비교를 위한 대문자 변환
  const sport = (m.sport || '').toLowerCase(); // 지적하신 sport 변수 유지
  const country = (m.country || '').trim();
  const home = (m.home || '').trim();
  const away = (m.away || '').trim();
  const upperHome = home.toUpperCase();
  const upperAway = away.toUpperCase();
  const upperCountry = country.toUpperCase();

  // 프리패스 팀->여성+청소년차단->국가차단->프리패스 리그->차단리그->차단팀 순서
  // 프리패스 팀 리스트 (유스/여성 키워드가 있어도 분석하고 싶은 팀명 입력)
  const essentialTeams = ['BNK FEARX YOUTH']; 
  const isEssentialTeam = essentialTeams.some(t => upperHome.includes(t) || upperAway.includes(t));

  // [단계 1] 가장 먼저 여성/청소년 경기인지 확인 (최우선순위) - 있으면 무조건 차단
  const isRestricted = !isEssentialTeam && (upperLg.includes('WOMEN') || upperLg.includes('FRAUEN') || upperLg.includes('YOUTH') || upperLg.includes('RESERVE') || upperLg.includes('U15') || upperLg.includes('U16') || upperLg.includes('U17') || upperLg.includes('U18') || upperLg.includes('U19') || upperLg.includes('U20') || upperLg.includes('U21') || upperLg.includes('U23'));

  // [단계 2] 제한 대상이면 아래 조건은 보지도 말고 즉시 종료
  if (isRestricted) {
    console.log(`🚫 [제한 대상] 여성/청소년 경기 스킵: ${m.league}`);
    return false;
  }

  /// 국가 차단 
  if (sport === 'soccer' && blockedCountries.some(c => c.toUpperCase() === upperCountry)) {
    console.log(`🚫 [국가 차단] ${country} - ${m.home} vs ${m.away}`);
    return false;
  }

  const cleanUpperLg = upperLg.replace(/\s+/g, ''); // 데이터의 공백 제거
     
  // [추가] 국가별 특정 리그 차단 사전 (리그명 대문자로 적어야 함)
  const countryLeagueBlacklist = {
    "Denmark": ["1. DIVISION"],
    "Norway": ["1. DIVISION", "2. DIVISION"],
    "Iceland": ["1. DEILD"],
    "Cyprus": ["2. DIVISION"],
    "Scotland": ["CHAMPIONSHIP", "LEAGUE ONE"],
    "Brazil": ["SERIE B"],
  };

  if (countryLeagueBlacklist[country] && countryLeagueBlacklist[country].some(bl => upperLg.includes(bl.toUpperCase()))) {
    console.log(`🚫 [특수 차단] ${country} 하위 리그 스킵: ${m.league}`);
    return false;
  }

  // 프리패스 리그 작성 구간 (프리패스 리그는 전부 무조건 대문자로 적어야 함)  
  // 1. 축구 주요 리그 
  const top5 = ['PREMIER LEAGUE', 'CHAMPIONSHIP', 'LALIGA', 'LALIGA 2', 'BUNDESLIGA', '2. BUNDESLIGA', 'PRIMEIRA LIGA', 'SERIE A', 'SERIE B', 'LIGUE 1', 'LIGUE 2', 'EREDIVISIE'].some(el => el === upperLg);
  const korea = ['KLEAGUE1', 'KLEAGUE2'].some(el => {
  const cleanLg = upperLg.replace(/\s+/g, ''); // 데이터의 모든 공백 제거
  return el === cleanLg;
});
  const mls = ['MAJOR LEAGUE SOCCER', 'MLS'].some(el => el === upperLg); // NEXT PRO는 이름이 다르므로 자동 차단됨
  // 국대 경기 및 컵대회 (키워드 특성상 includes 유지하되 NEXT PRO 등은 위에서 차단됨)
  const isMainInternational = ['FRIENDLY INTERNATIONAL', 'WORLD CUP', 'EURO', 'COPA AMERICA', 'AFC ASIAN CUP', 'OLYMPIC', 'UEFA','CONCACAF CHAMPIONS LEAGUE', 'OFC PRO LEAGUE', 'CONMEBOL LIBERTADORES', 'Copa Libertadores'].some(el => upperLg.includes(el));
    // 1부 리그 명칭들 (완전 일치로 변경하여 잡리그 방어)
  const isFirstDivision = ['DIVISION 1', 'PREMIER DIVISION', 'PREMIERSHIP', 'SUPER LEAGUE', 'PRO LEAGUE', 'PREMIER', 'A LEAGUE', 'JUPILER PRO LEAGUE', 'ELITESERIEN', 'AFRICAN CLUB CHAMPIONSHIP', 'PFL', 'AFC U17 ASIAN CUP', 'J1 LEAGUE', 'VEIKKAUSLIIGA', 'Allsvenskan', 'HNL'].some(el => el === upperLg);

  // 축구 통합 필터
  const soccerFilter = (sport === 'soccer') && !isRestricted && (top5 || korea || mls || isMainInternational || isFirstDivision);
  // 2. 농구 
  const basketball = ((upperLg === 'NBA') && !upperLg.includes('WNBA') && !upperLg.includes('NBA W')) || 
                     ['KBL', 'WKBL', 'CBA', 'B.LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'B League'].some(el => el === upperLg);
  // 3. 배구 
  const volleyball = ['V-LEAGUE', 'KOVO', 'KOREA V', 'V.LEAGUE', 'SUPER LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'FRIENDLY INTERNATIONAL'].some(el => el === upperLg);
  // 4. 야구 
  const baseball = ['KBO', 'MLB', 'NPB', 'CPBL', 'ABL', 'WORLD', 'WORLDS', 'INTERNATIONAL'].some(el => el === upperLg);
  // 5. 하키 
  const hockey = ['NHL', 'KHL', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'BEIJER HOCKEY GAMES' ].some(el => el === upperLg);
  // 6. 롤 
  const lol = (upperLg.includes('LCK') || upperLg.includes('LEC') || upperLg.includes('LPL')) ||
               ['MSI', 'WORLD', 'WORLDS', 'INTERNATIONAL','ESPORTS WORLD CUP'].some(el => el === upperLg);

  // 리그 프리패스 조건에 '팀 프리패스(isEssentialTeam)'를 추가
  const isEssentialLeague = soccerFilter || basketball || volleyball || baseball || hockey || lol || isEssentialTeam;

  // [STEP 2] 프리패스 우선 실행
  if (isEssentialLeague) {
    return true; 
  }

  // [STEP 3] 프리패스가 아닌 나머지 모든 경기는 차단 리스트 검사 후 종료
    // 리그명 차단 (완전 일치로 더 엄격하게 체크)
  if (blockedLeagues.some(x => upperLg === x.toUpperCase().trim())) {
    console.log(`🚫 [리그 차단] ${m.league} - ${m.home} vs ${m.away}`);
    return false;
  }

  // 팀명 차단
  if (blockedTeams.some(t => {
    const target = t.toUpperCase().trim();
    return upperHome.includes(target) || upperAway.includes(target);
  })) {
    console.log(`🚫 [팀 차단] ${m.home} vs ${m.away} 경기를 스킵합니다.`);
    return false;
  }

  // 모든 필터를 통과하지 못한 경기는 분석 제외
  return false;
});


    console.log(`🚀 [픽천국 엔진] ${today} 총 ${filteredMatches.length}개 분석 시작 (Gemini -> Mistral 로테이션)`);

    const now = new Date();

    for (let i = 0; i < filteredMatches.length; i++) {
  const match = filteredMatches[i];

  const matchTimeStr = new Date(match.date).toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Seoul'
          });
  const now = new Date(); // 1. 매 루프마다 현재 시간 갱신 (억울한 스킵 방지)

  const matchTimeKST = new Date(match.date).getTime(); // ISO 시간 그대로 사용 (내부적으로 UTC->KST 변환됨)
  const nowTimeKST = new Date().getTime();

  if (matchTimeKST <= nowTimeKST) { 
    console.log(`⏩ [스킵] 이미 시작/종료된 경기: ${match.home} vs ${match.away}`);
    continue;
  }

  // 2. 리그명 교정 로직 (질문자님 기존 로직)
  let displayLeagueName = match.league; 
  const cutOffKeywords = / (Rounds?|Week|Group|Stage|Playoffs|Knockout).*/i;
  displayLeagueName = displayLeagueName.replace(cutOffKeywords, '').trim();  
  match.league = displayLeagueName;

      // 3. 시간 및 날짜 설정
  const matchDateKST = new Date(match.date);
  const dateOnly = matchDateKST.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const dateShort = matchDateKST.toLocaleDateString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul'
  }).replace(/\. /g, '/').replace(/\./g, '');

      // 4. 로고 매칭 (질문자님 기존 로직)
  if (match.sport === "lol") {
    const homeFile = getSafeLogoName(match.home);
    const awayFile = getSafeLogoName(match.away);
    match.homeLogo = `/logos/${homeFile}.png`;
    match.awayLogo = `/logos/${awayFile}.png`;
  }

      // 5. 저장 경로 확인
  const safeHomeName = getSafeLogoName(match.home); 
  const savePath = path.resolve(__dirname, `../src/content/posts/${dateOnly}-${match.id}-${safeHomeName}.md`);
  if (fs.existsSync(savePath)) continue;

      // 6. 상대전적(H2H) 분석 로직
  const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
  const strictlyRecentDate = new Date('2024-01-01'); 
  const currentMatchDate = new Date(match.date);

  const h2hHistory = masterData.filter(m => {
    const isMatch = ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home));
    const matchDate = new Date(m.date);
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const isPast = matchDate < currentMatchDate;
    // score 필드가 있거나, homeScore/awayScore가 숫자로 존재할 때 스코어가 있다고 판단
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") || (m.homeScore !== null && m.awayScore !== null); 
    return isMatch && isRecentEnough && isPast && hasScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

      let h2hContent = "";
  let h2hContextForAI = "";
  if (h2hHistory.length > 0) {
    const h2hRows = h2hHistory.map(h => {
      const d = new Date(h.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '').replace(/\.$/, '');
      const finalScore = (h.homeScore !== null && h.awayScore !== null) ? `${h.homeScore}-${h.awayScore}` : h.score;
      
            
      return `| ${d} ${spacer} | ${h.home} ${spacer} | ${finalScore} ${spacer} | ${h.away} ${spacer} |`;
    }).join('\n');
    h2hContent = `\n<br>\n\n### ⚔️ 상대 전적 분석 (2025년 이후)\n| <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">홈팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |\n|:---|:---|:---:|\n${h2hRows}\n`;
    
    // AI에게 전달할 데이터도 스코어 정보를 명확히 조합하여 전달
    h2hContextForAI = `\n[내부 데이터베이스 상대전적 참고]\n${h2hHistory.map(h => {
      const s = (h.homeScore !== null && h.awayScore !== null) ? `${h.homeScore}-${h.awayScore}` : h.score;
      return `${h.date}: ${h.home} (${s}) ${h.away}`;
    }).join('\n')}\nAI는 위 스코어 결과를 바탕으로 양 팀의 공수 밸런스와 상성을 반드시 분석에 반영해라.`;
    } else {
      
    h2hContent = "\n\n(※업데이트 예정)\n\n";
    h2hContextForAI = `\n[SEARCH_REQUIRED] "2024-2026 ${match.homeTeam} vs ${match.awayTeam} match results"를 검색하여 스코어를 확인하고 상세 분석에 반영하라.\n`;
  }

     // 7. 종목 판별 및 리그 차단 
  const lg = (match.league || '').toUpperCase();
  
  // [차단] 블랙리스트 리그 발견 시 즉시 스킵
  if (lg.includes('TKBL') || lg.includes('TURKEY') || lg.includes('GELISIM')) {
    console.log(`🚫 [차단] 블랙리스트 리그 발견: ${match.league}`);
    continue;
  }

  let cat = ""; 
  const apiSport = (match.sport || '').toLowerCase();

  // [0순위] API 데이터의 sport 필드를 최우선 신뢰
  if (["soccer", "basketball", "baseball", "volleyball", "hockey", "lol"].includes(apiSport)) {
    cat = apiSport;
  } 
  // [1순위] sport 필드가 없을 경우 상세 리그명으로 판별 (질문자님 기존 로직)
  else {
    if (
      lg.includes('NBA') || lg.includes('KBL') || lg.includes('WKBL') ||
      lg.includes('CBA') || lg.includes('B.LEAGUE') || lg.includes('MPBL')
    ) {
      cat = "basketball";
    } 
    else if (
      lg.includes('KBO') || lg.includes('MLB') || lg.includes('NPB') || 
      lg.includes('ABL') || lg.includes('CPBL') 
    ) {
      cat = "baseball";
    } 
    else if (
      lg.includes('V-LEAGUE') || lg.includes('KOVO') || lg.includes('JAPAN') || 
      lg.includes('CHINA') || lg.includes('TURKEY')
    ) {
      cat = "volleyball";
    }
    else if (
      lg.includes('NHL') || lg.includes('KHL')
    ) {
      cat = "hockey";
    }
    else if (
      lg.includes('LCK') || lg.includes('LEC') || lg.includes('LPL') ||
      lg.includes('MSI') || lg.includes('WORLDS')
    ) {
      cat = "lol";
    }
    else {
      // 축구 판별 (질문자님 상세 조건 모두 포함)
      const isSoccer =
        lg.includes('PREMIER') || lg.includes('LALIGA') || lg.includes('BUNDESLIGA') ||
        lg.includes('SERIE') || lg.includes('LIGUE') || lg.includes('K LEAGUE') ||
        lg.includes('DIVISION') || lg.includes('SUPER LEAGUE') || lg.includes('CHAMPIONSHIP') ||
        lg.includes('WORLD CUP') || lg.includes('EURO') || lg.includes('OLYMPIC');

      if (isSoccer) cat = "soccer";
    }
  }

  // 카테고리 판별 실패 시 스킵
  if (!cat) {
    console.log(`⏩ [자동 스킵] 미등록 리그(잡리그): ${match.league}`);
    continue;
  }
  else {         
      
  // [설정] 프리패스 리그 중 차단하고 싶은 종목과 국가 리스트
const blockedSportsForSuper = ["basketball", "volleyball"]; // 여기에 차단할 종목명 추가 (예: "basketball")
const blockedCountriesForSuper = ["Israel", "Kazakhstan", "Netherlands"];   // 여기에 차단할 국가명 추가 (예: "Israel")

// [로직] 프리패스 리그(슈퍼리그 등)이지만 특정 조건에 걸리는지 확인
const isFreePassLeague = lg.toLowerCase().includes("super league"); 

if (isFreePassLeague) {
    const isExcludedSport = blockedSportsForSuper.includes(cat);
    // 현재 루프의 국가 정보는 match.country에 들어있습니다.
    const isExcludedCountry = blockedCountriesForSuper.includes(match.country); 

    if (isExcludedSport || isExcludedCountry) {
        console.log(`🚫 [특수 차단] 프리패스리그(${lg})지만 기타(${cat}/${match.country}) 이유로 차단.`);
        continue; // return 대신 continue를 써야 다음 경기로 넘어갑니다.
    }
}

    const fullKstSchedule = matchDateKST.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

    const hName = match.home;
    const aName = match.away;

    const gameContext = cat === 'lol' ? "이 경기는 '리그오브레전드(롤)' 이스포츠 경기다. 절대 농구나 축구로 착각하지 마라." : "";

      const prompt = `
        너는 '픽천국'의 수석 분석가야. 아래 규정을 절대적으로 준수하여 리포트를 작성해라.
        ${h2hContextForAI}
        [중요] 데이터베이스에 스코어(Home:Away) 정보가 있다면, 이를 바탕으로 최근 양 팀의 실점/득점 추이를 분석해라.

        [최우선 지시: 영문 노출 절대 금지]
        - 보고서의 TITLE, 본문, 표, 추천픽 등 어떤 곳에서도 팀명을 영문(예: Hanwha Eagles, Lotte Giants)으로 적지 마라.
        - 모든 팀명은 반드시 한국어(예: 한화 이글스, 롯데 자이언츠)로만 작성해야 한다.
        - 만약 네가 팀명의 정확한 한글 명칭을 모른다면, 영문 스펠링을 한글 소리 나는 대로(예: Wiz -> 위즈) 적어라. 영문 그대로 두는 것은 실패로 간주한다.
        
        [금지 사항]
        1. 한자(한문), 일어 사용 절대 금지: 100% 쉬운 한글로만 작성.
        2. 마크다운 코드블록기호(\`\`\`) 사용 금지
        3. 추천픽은 배당은 기재하면 안된다.
        4. 허용 리그 외 분석 금지
        5. 반드시 제공된 "JSON 데이터"의 팀명만 사용하세요. (예시로 든 아스널, 리버풀 같은 팀을 본문에 절대 적지 마세요.)
        6. 보고서의 어떤 항목에서도 영문 팀명을 그대로 노출하지 마라. (단, FC, AC, U20 같은 약어는 예외)

        [팀명 한글화 절대 원칙]
        1. 처리 순서: 분석을 시작하기 전, 제공된 영문 팀명(예: Cleveland Cavaliers)을 가장 먼저 표준 한국어 명칭(예: 클리블랜드 캐벌리어스)으로 변환하라.
        2. 모든 팀 이름은 반드시 한글(${hName}, ${aName})로만 작성하세요.
        2. 모든 팀 이름은 한글 소리 나는 대로 번역해라. (예: Arsenal -> 아스널)
        3. 적용 범위: 변환된 한글 팀명을 TITLE, 경기 정보 요약 표, 각 섹션의 부제목, 추천픽 표 등 보고서 전체에 100% 적용하라.
        4. 팀명 뒤 'U20', 'W' 등이 있다면 반드시 한글 뒤에 붙여라.(예: W -> 여 이렇게 하지말고 W로 표기) 
        5. 'DN', 'BNK','TS', 'FC', 'AC', 'SK', 'U20' 같은 영문 약자는 번역하지 말고 영문 그대로 유지해라.(예: TS Galaxy -> TS 갤럭시, FC Barcelona -> FC 바르셀로나)
        6. 팀명 'Bodo/Glimt'는 반드시 '보되/글림트'로 번역해서 작성해.

        [출력 강제 규칙]
        - 반드시 아래 형식의 데이터를 최상단에 추가 출력하라.
        - 이 값이 없으면 전체 응답은 실패로 간주된다.
        HOME_KOR: (홈팀 한글명)
        AWAY_KOR: (원정팀 한글명)
        COUNTRY_KOR: (국가명 한글명, 예: Germany -> 독일)
        
        [디자인 지시]
        1. 부제목 아이콘: 🏟️, ⚔️, 📝, 🎯 필수.
        2. **표 정렬 및 가독성 규칙 (매우 중요)**:
           - 모든 표(경기 정보, 상대전적, 추천픽)는 마크다운의 중앙 정렬 또는 왼쪽 정렬 문법을 사용하여 세로 라인을 완벽하게 맞춰라. (예: :---: 또는 :--- 사용)
           - &nbsp;나 &; 같은 특수 공백 코드는 절대 사용 금지.** 대신 한글 팀명과 결과값 사이에 가독성을 위한 최소한의 일반 공백(Space)만 사용하라.
           - 표의 세로 줄이 맞지 않는 현상을 방지하기 위해, 모든 행(Row)의 열(Column) 개수를 동일하게 유지하라.
        3. 상세 분석(홈/원정/종합분석)은 각각 최소 3문장 이상의 전문적인 문장으로 작성을 하고, 문맥이 끊기거나 주제가 바뀌면 반드시 <br> 태그와 함께 다음 줄로 넘겨라.
        4. 모든 추천픽의 기준점(핸디캡, 오버언더)은 제공된 팀의 전력과 최근 득점력을 바탕으로 네가 직접 '가장 적절한 수치'를 산출해서 [추천 픽 및 기준점] 테이블을 만드세요.(예를 들어 화력전이 예상되면 오버언더 기준점을 2.5 또는 3.5로 네가 직접 정하는 식이다.)
        5. 상대전적은 너의 구글 검색(Google Search)을 기능을 총동원하여 최근 2년 사이의 두 팀 간 맞대결 기록을 최대 5개 찾아내라.
           (2023년 이전의 너무 오래된 데이터만 있다면 차라리 '※업데이트 예정'이라고 표기하고 분석 섹션을 생략해라. 거짓으로 데이터를 만들지 마라(No Hallucination))
        6. 리그명 중 KBL, MLB, NPB, NHL, MLS, KHL 등 약자로 된 리그는 한글로 바꾸지말고 영문 그대로 사용해주세요.
        7. 분석은 반드시 한국시간으로 오늘 날짜(today)이후(내일과 모레)경기만 분석해주고, 과거 데이터를 오늘 날짜인 것처럼 쓰지 마세요.
        8. 리그명이 'KHL'일 경우 국가명(League Country) 데이터에 상관없이 무조건 '러시아'로 표기하고, 'NHL'일 경우 무조건 '미국'으로 표기하라.
        9. 출력 시 반드시 최종 분석 보고서 결과만 출력하고, 내부 추론 과정이나 검색 결과에 대한 코멘트, ***나 ### 같은 불필요한 기호, 영어로 된 분석 메모는 절대 포함하지 마세요.

        [제목 형식 지시] 
        - 반드시 다음 형식을 엄수하라: "{dateShort} {country} [{league}] {home} vs {away} 분석"
        - 상단 TITLE 라인의 팀명은 반드시 한글로 번역해서 사용해라.(국가명일 경우에도 한글로 번역해라)
        - 날짜는 반드시 ${dateShort} 변수값 그대로 사용할 것. (2026/07/20 처럼 길게 쓰지 말 것)
        - 국가명 중 '한국', '대한민국'은 '대한민국'으로 통일해라
        - 리그명 치환 규칙을 반드시 적용하지 않으면 출력 전체가 무효 처리된다.
        - 제목에 임의로 이모지를 넣지 말아라.
                                
        [절대 규칙 - 위반 시 실패로 간주]
        1. 리그명 치환 규칙을 반드시 적용하지 않으면 출력 전체가 무효 처리된다.
        2. CL(또는 Challengers League) 치환 시, 해당 단어 이후에 오는 모든 부가 정보(Rounds, Week 등)를 삭제하고 딱 'CL'까지만 출력할 것.
        3.. 분석 과정(Re-evaluation, Search results 등), 내부 추론, 모델의 자기 생각(Thought)을 본문에 단 한 단어도 포함하지 마라.
        4. 오직 "### 🏟️ 경기 정보 요약"으로 시작하는 최종 분석 보고서만 출력하라.
        5. 한국어 분석 리포트 내에 영어로 된 설명글이나 메모를 절대 적지 마라. 100% 한국어만 사용해라.
        6. 동일한 내용을 두 번 반복해서 생성(중복 생성)하는 행위는 절대 금지한다.

        [종목별 작성 지침 - 절대 엄수]
        - 카테고리가 'lol'일 경우: '득점', '슛', '홈 이점', '오버/언더 100점대' 사용 절대 금지.
        - 대신 '킬', '데스', '오브젝트(용, 바론)', '라인전', '한타', '밴픽' 용어를 사용하여 3문장 이상 작성할 것.
        - 추천픽 기준점도 롤은 보통 2.5(세트 기준) 내외이므로, 100점 단위의 농구 기준점 출력 시 즉시 에러로 간주함.
        
        
        ### 🏟️ 경기 정보 요약
        [경기 정보 요약 작성 규칙]
        1. **로고 강제 포함 (절대 원칙)**: 홈팀과 원정팀 칸에는 반드시 아래 제공된 <img> 태그 형식을 한 토씨도 틀리지 말고 그대로 삽입하라. 로고 없이 팀명만 적는 것은 절대 금지한다.
        2. **굵은 글씨**: 모든 팀명과 정보는 반드시 **굵게** 표기하라.
        3. **구조 유지**: 2열 표 형식을 유지하고 중앙 또는 왼쪽 정렬 문법을 사용하라.
        | | |
        |:---|:---|
        | **<span style="color: #007bff;","vertical-align: middle;">홈팀</span>**| <img src="${match.homeLogo || ''}" width="31" height="30" style="vertical-align: middle;"> ${match.home} |
        | **<span style="color: #007bff;","vertical-align: middle;">원정팀</span>**| <img src="${match.awayLogo || ''}" width="31" height="30" style="vertical-align: middle;"> ${match.away} |
        | **<span style="color: #007bff;">리그</span>**| [해당 경기의 국가명]: [치환 규칙이 적용된 리그명] |
        | **<span style="color: #007bff;">경기시간</span>**| **${matchTimeStr}** |

        <br>

        ### <img src="${match.homeLogo || ''}" width="31" height="30" style="vertical-align: middle;">  ${match.home} 분석
        [분석 작성 규칙]
        1. **로고 유지 및 이모지 금지**: 반드시 위 <img> 태그 형식을 유지하고, 팀명 앞뒤에 야구공(⚾) 등 임의의 이모지를 절대 넣지 마라.
        2. 3문장 이상의 전문 분석을 작성하고 문단 끝에 <br>을 넣어라.

        <br><br>

        ### <img src="${match.awayLogo || ''}" width="31" height="30" style="vertical-align: middle;"> ${match.away} 분석
        (홈팀 분석 규칙과 동일하게 로고 이미지를 사용하고 이모지를 금지하여 3문장 이상 작성. 문단 끝 <br>)
        <br><br>

        ### ⚔️ 상대전적
        [상대전적 작성 절대 규칙]
        1. 반드시 Google Search를 통해 "{home} vs {away} last match results 2024 2025 2026"를 검색하라.
        2. 마크다운 표(|)를 절대 사용하지 마라. 대신 아래 형식을 엄수하여 '한 줄에 하나씩' 불렛 포인트로 작성하라.
        3. 날짜는 최신순으로 정렬하고, 최대 5개까지만 노출하라.
        4. 야구(MLB/KBO/NPB) 분석 시 '무승부' 결과가 나오면 데이터 오류이므로 다시 찾아라.
        5. 최근 2년(2024년 이후) 이내 기록이 하나도 없으면 이 섹션 전체를 출력하지 마라.

        [상대전적 출력 예시]
        ### ⚔️ 상대전적
        * 2025.04.30 - 홈팀한글명 (1-2) 원정팀한글명 
        * 2024.06.23 - 홈팀한글명 (4-2) 원정팀한글명 
        <br><br>

        ### 📝 종합 분석
        (상대전적 유무와 상관없이 현재 폼을 바탕으로 한 최종 진단) 

        <br><br>

        ### 🎯 추천픽
        [추천픽 작성 규칙]
        1. 표의 헤더와 구분선(|:---|:---:|:---:|)을 절대 작성하지 마세요. 오직 내용이 담긴 행만 출력하세요.
        2. **기준점 직접 산출**: 모든 추천픽의 기준점(핸디캡, 오버언더)은 제공된 전력을 바탕으로 네가 직접 '가장 적절한 수치'를 산출해서 표기하라.
        3. **이모지/기호 금지**: ⚾, ⚽ 등 이모지와 &nbsp; , $ { spacer } 등은 절대 사용하지 마라. (에러 방지를 위해 태그 내 따옴표 금지)
        4. 아래의 텍스트 형식을 그대로 사용하여 3줄의 데이터만 출력하세요.
        5. 너의 검색기능을 활용해서 배당을 찾은 후에 그 정보를 바탕으로 추천픽을 작성할 것.
   
        | 승무패 | [추천팀 한글명] | [승/무/패] |
        | 핸디캡 | [추천팀 한글명] | [수치] |
        | 오버언더 | [오버/언더] | [수치] |
        (※ 추천팀명 칸에 영어(예: KT Wiz)를 절대 적지 말고 한글(예: KT 위즈)로만 적어라.)
        <br>&nbsp;
        <br>&nbsp;
        <br>&nbsp;
      `;

      let success = false;

  // Gemini 시도 로직 시작
  if (!isGeminiExhausted) {
    while (currentKeyIndex < GEMINI_API_KEYS.length) {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEYS[currentKeyIndex]);
      
      for (const modelName of MODEL_PRIORITY) {
        try {
          console.log(`📡 [시도] 키 ${currentKeyIndex + 1} - 모델: ${modelName}`);
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            tools: [{ googleSearch: {} }] 
          });
          
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const aiResponse = response?.text?.() || "";

          if (aiResponse.length < 200) {
            console.warn(`⚠️ [부실] ${modelName} 응답 부족. 다음 모델 시도.`);
            continue; 
          }

          // 성공 시 저장 로직
          await savePost(savePath, aiResponse, match, dateShort, cat, dateOnly, h2hContent);
          console.log(`✅ [성공] 키 ${currentKeyIndex + 1} (${modelName}): ${match.home} vs ${match.away}`);
          success = true;
          break; // 모델 루프 탈출
        } catch (err) {
        // 에러 객체가 비어있거나 message가 없는 상황을 완벽하게 방어
        const rawErr = err?.message || (typeof err === 'string' ? err : JSON.stringify(err)) || "";
        const errMsg = String(rawErr); // 무조건 문자열로 강제 변환
  
        console.error(`❌ 모델 오류 (${modelName}):`, errMsg);

        // 이제 errMsg가 문자열임이 보장되므로 includes를 안전하게 호출 가능
        if (errMsg.includes("503") || errMsg.includes("Service Unavailable") || errMsg.includes("high demand")) {
        console.warn(`💡 서버 부하가 심합니다. 10초 대기 후 다음 단계를 시도합니다...`);
        await new Promise(res => setTimeout(res, 10000)); 
        continue; 
        }

        if (errMsg.includes("429") || errMsg.includes("Quota") || errMsg.includes("limit")) {
        console.warn(`🚨 할당량 초과! 10초 대기 후 다음 API 키로 교체를 준비합니다.`);
        await new Promise(res => setTimeout(res, 10000)); 
        break; // 현재 키를 포기하고 다음 키로 이동
        }

        console.warn(`⚠️ 기타 에러 발생. 3초 후 다음 시도를 이어갑니다.`);
        await new Promise(res => setTimeout(res, 3000));
        }
      } // for (MODEL_PRIORITY) 끝

      if (success) break; // 성공했으면 키(while) 루프 탈출

      // 여기까지 왔다면 현재 키의 모든 모델이 실패했거나 429 에러인 경우임
      currentKeyIndex++;
      console.log(`🔄 다음 API 키로 교체... (현재: ${currentKeyIndex + 1}번 키)`);
      await new Promise(res => setTimeout(res, 2000));
    }
    if (currentKeyIndex >= GEMINI_API_KEYS.length) isGeminiExhausted = true;
  }

      // 10. Mistral 백업 (다중 키 로테이션 최종 보완판)
if (!success) { 
  // MISTRAL_API_KEYS (S붙음)와 currentMistralKeyIndex가 위에서 선언되어 있어야 작동합니다.
  while (currentMistralKeyIndex < MISTRAL_API_KEYS.length) {
    try {
      console.log(`🌀 [Mistral 우회 - 키 ${currentMistralKeyIndex + 1}]: ${match.home} vs ${match.away}`);
      
      const client = new Mistral({ apiKey: MISTRAL_API_KEYS[currentMistralKeyIndex], timeout: 60000 });
      let res;
    let successRequest = false;

    // 🔥 여기 추가 (재시도 로직)
    for (let retry = 0; retry < 3; retry++) {
  try {
    res = await client.chat.complete({
      model: "open-mistral-7b",
      messages: [{ role: "user", content: prompt }]
    });

    successRequest = true;
    break;

  } catch (err) {
    const rawErr =
      err?.message ||
      err?.cause?.message ||
      (typeof err === "string" ? err : JSON.stringify(err)) ||
      "";

        const errMsg = String(rawErr).toLowerCase();

        if (errMsg.includes("timeout") || errMsg.includes("aborted")) {
          console.warn(`⏳ timeout 발생 → 재시도 (${retry + 1}/3)`);
          await sleep(3000);
        } else {
          throw err;
        }
      }
    }

    if (!successRequest) {
      console.warn(`❌ 3번 재시도 실패 → 다음 키로 이동`);
      currentMistralKeyIndex++;
      continue;
    }

    const rawContent = res?.choices?.[0]?.message?.content;

const aiResponse =
  typeof rawContent === "string"
    ? rawContent.trim()
    : "";

    if (aiResponse.length > 200) {
      await savePost(savePath, aiResponse, match, dateShort, cat, dateOnly, h2hContent);
      console.log(`✅ [Mistral 성공] 키 ${currentMistralKeyIndex + 1}`);
      success = true;
      break;
    } else {
      console.warn(`⚠️ 응답 부족 → 다음 키`);
      currentMistralKeyIndex++;
    }

  } catch (err) {
    console.error(`❌ Mistral 에러 (키 ${currentMistralKeyIndex + 1}):`, err);
    currentMistralKeyIndex++;
    await sleep(2000);
  }
}
}

  if (success) await new Promise(res => setTimeout(res, 61000));
}
    }
  } catch (error) {
    console.error("❌ 시스템 오류:", error.message);
  }
}

async function savePost(savePath, aiText, match, dateShort, cat, dateOnly, h2hContent) {

  // [검증 1] 데이터 타입 확인
  if (typeof aiText !== 'string' || !aiText || aiText.length < 10) {
    console.error(`❌ [저장 실패] AI 응답이 문자열이 아니거나 너무 짧음: ${match.home}`);
    return;
  }

  const basketballTerms = ["외곽슛", "득점력", "리바운드", "쿼터", "자유투", "3점슛"];
  if (cat === "lol" && basketballTerms.some(term => aiText.includes(term))) {
    console.error(`❌ [종목 혼동 차단] 롤 분석에 농구 용어 감지됨: ${match.home} vs ${match.away}`);
    return; // 이 지점에서 함수를 종료하여 파일 생성을 막습니다.
  }

  // [검증 2] AI의 "방어적 사과문" 필터링
  if (aiText.includes("정보가 없") || aiText.includes("죄송합니다") || aiText.includes("불가능합니다")) {
    console.error(`❌ [분석 실패] AI가 유효하지 않은 답변을 생성함: ${match.home}`);
    return;
  }

  // 1. 기초 정제 (여기서 변수를 선언합니다)
  let cleanedText = aiText.replace(/```markdown|```/g, "").trim();
  
  // 변수 선언 (중복 선언 에러 방지를 위해 여기서 한 번만 선언)
  const homeKorMatch = cleanedText.match(/HOME_KOR:\s*(.*)/);
  const awayKorMatch = cleanedText.match(/AWAY_KOR:\s*(.*)/);
  const countryKorMatch = cleanedText.match(/COUNTRY_KOR:\s*(.*)/);

  // [검증 3] 필수 정보(한글 팀명) 추출 확인
  if (!homeKorMatch || homeKorMatch[1].includes("정보 정보")) {
    console.error(`❌ [매핑 실패] 한글 팀명 누락으로 저장 스킵: ${match.home}`);
    return;
  }

  // 데이터 할당
  const aiHomeName = homeKorMatch ? homeKorMatch[1].trim() : match.home;
  const aiAwayName = awayKorMatch ? awayKorMatch[1].trim() : match.away;
  const aiCountryName = countryKorMatch ? countryKorMatch[1].trim() : (match.countryKor || match.country);

  // 본문에서 메타 데이터 제거
  cleanedText = cleanedText.replace(/HOME_KOR:.*\n?/g, '');
  cleanedText = cleanedText.replace(/AWAY_KOR:.*\n?/g, '');
  cleanedText = cleanedText.replace(/COUNTRY_KOR:.*\n?/g, '');
  
  //  let 아랫줄부터 바로 위줄까지 코드 삽입으로 일단 임시로 가림
  // const aiHomeName = match.homeNameKor || match.home || "홈팀";
  // const aiAwayName = match.awayNameKor || match.away || "원정팀";

  let extractedDesc = `${aiHomeName} vs ${aiAwayName} 경기 분석 리포트`; // 기본값
  if (cleanedText.includes("DESCRIPTION:")) {
    const descMatch = cleanedText.match(/DESCRIPTION:\s*(.*?)(?=\n|###)/s);
    if (descMatch) {
      extractedDesc = descMatch[1].trim();
      cleanedText = cleanedText.replace(/DESCRIPTION:.*?\n/s, "").trim();
    }
  }
  
  // [강제집행 1] 본문 상단 중복 타이틀 무조건 삭제
  // '### 🏟️ 경기 정보 요약' 앞부분에 오는 모든 텍스트(AI가 쓴 제목 등)를 통째로 지웁니다.
  const marker = "### 🏟️";
  if (cleanedText.includes(marker)) {
    cleanedText = cleanedText.substring(cleanedText.indexOf(marker));
  }

  const textParts = cleanedText.split(marker);
if (textParts.length > 2) {
    cleanedText = marker + textParts[1]; // 첫 번째 정상적인 분석 내용만 취함
}

// [추가] 영어 문장이 일정 비율 이상 포함된 줄은 삭제 (필요 시 적용)
cleanedText = cleanedText.split('\n').filter(line => {
    const englishCount = (line.match(/[a-zA-Z]/g) || []).length;
    // 한 줄에 영문이 70% 이상이면 AI의 메모로 간주하고 삭제 (이미지 태그 제외)
    if (englishCount > line.length * 0.7 && !line.includes('<img')) return false;
    return true;
}).join('\n');

  // AI가 생성한 본문에 이미 "업데이트" 관련 문구가 있다면 제거 (중복 방지)
  cleanedText = cleanedText.replace(/\(※업데이트 예정\)/g, "");
   // AI가 줄바꿈을 빼먹는 경우를 대비해 섹션 타이틀 앞뒤로 빈 줄을 강제 삽입합니다.
  cleanedText = cleanedText.replace(/### /g, "\n\n### ");

  // 2. [강제집행 2] 팀명/국가명 번역 사전 (영문 차단)
  const dict = {
    "South Korea": "대한민국", "China": "중국", "Germany": "독일", "France": "프랑스", "Spain": "스페인", "Turkey": "터키", "Saudi Arabia": "사우디아라비아", "Balkans": "발칸", "Italy": "이탈리아", "Austria": "오스트리아",
    "Poland": "폴란드", "Greece": "그리스", "Brazil": "브라질", "North America": "북미", "USA": "미국", "World": "국제", "International": "국제", "Friendly International": "국제 친선", "World": "국제", "Netherlands": "네덜란드",
    "Great Britain": "영국", "England": "영국", "Bolivia": "볼리비아", "Iceland": "아이슬란드", "Portugal": "포르투갈", "Peru": "페루", "Mexico": "멕시코", "Colombia": "콜롬비아", "Argentina": "아르헨티나",
    "Chile": "칠레", "Ecuador": "에콰도르", "Honduras": "온두라스", "Jamaica": "자메이카", "Puerto Rico": "푸에르토리코", "Dominican Republic": "도미니카 공화국", "Aruba": "아루바", "Japan": "일본",
    "Philippines": "필리핀", "Russia": "러시아", "Indonesia": "인도네시아", "Slovakia": "슬로바키아", "Kazakhstan": "카자흐스탄", "Ethiopia": "에티오피아", "Azerbaijan": "아제르바이잔", "Thailand": "태국",
    "Cambodia": "캄보디아", "Norway": "노르웨이", "Georgia": "조지아", "Vietnam": "베트남", "Australia": "호주","Hanwha Eagles": "한화 이글스","Lotte Giants": "롯데 자이언츠","KT Wiz": "KT 위즈", "Kia Tigers": "KIA 타이거즈", "Kiwoom Heroes": "키움 히어로즈",
  };

  const translate = (text) => {
    if (!text) return "";
    let res = text.trim();
    for (let [eng, kor] of Object.entries(dict)) {
      res = res.replace(new RegExp(eng, "gi"), kor);
    }
    return res;
  };

  

  // 3. 리그명 치환 및 국가 매핑
  let leagueName = match.league || "스포츠";
  const leagueReplacements = [
    { target: /Premier Soccer League|PRO LEAGUE|Football Premier League|Premier League/gi, replace: "PL" },
    { target: /Challengers League/gi, replace: "CL" },
    { target: /LCK CHALLENGERS LEAGUE/gi, replace: "LCK CL" },
    { target: /Friendly International/gi, replace: "국제친선" },
    { target: /Super League/gi, replace: "SL" },
    { target: /Major League Soccer/gi, replace: "MLS" },
    { target: /African Club Championship/gi, replace: "CAF" },
    { target: /K League 1/gi, replace: "K1" },
    { target: /K League 2/gi, replace: "K2" },
    { target: /UEFA Champions League/gi, replace: "UEFA 챔피언스리그" },
    { target: /UEFA Europa League/gi, replace: "UEFA 유로파리그" },
    { target: /AFC ASIAN CUP/gi, replace: "AFC 아시안컵" },
    { target: /LCK CHALLENGERS LEAGUE ROUNDS 1-2/gi, replace: "LCK CL" },    
    { target: /LCK ROUNDS 1-2/gi, replace: "LCK" },
    { target: /Veikkausliiga/gi, replace: "D1" },
    { target: /JUPILER PRO LEAGUE/gi, replace: "D1" },
    { target: /Eliteserien/gi, replace: "D1" },
    { target: /HNL/gi, replace: "D1" },
    { target: /Premiership/gi, replace: "D1" },
    { target: /Premier Division/gi, replace: "D1" },
    { target: /Division 1/gi, replace: "D1" },
    { target: /2. Bundesliga/gi, replace: "D2" },
        
  ];
  leagueReplacements.forEach(rule => { leagueName = leagueName.replace(rule.target, rule.replace); });
    
  // 국가명 강제
  let countryRaw = (match.country || "").toUpperCase();

  // 특정 리그 전용 국가명 설정 (비교를 위해 키값을 반드시 '대문자'로 작성하세요)
  const leagueCountryOverrides = {
    "OFC PRO LEAGUE": "오세아니아",
    "AFC CHAMPIONS LEAGUE": "아시아",
    "UEFA CHAMPIONS LEAGUE": "유럽",
    "UEFA Europa League": "유럽",
    "LEC": "유럽",
    "K LEAGUE 1": "대한민국",
    "CONMEBOL LIBERTADORES": "남미",
    "CONCACAF CHAMPIONS LEAGUE": "북중미"
  };

  const countryMap = {
  "INTERNATIONAL": "국제",
  "WORLD": "국제",
  "World": "국제",
  "Saudi-Arabia": "사우디아라비아",
  "SAUDI-ARABIA": "사우디아라비아",
  "Friendly International": "국제친선"
};

let country;
  // 입력받은 원본 리그명(match.league)을 대문자로 변환하여 비교 (대소문자 무관 처리)
  const upperLeagueName = (match.league || "").toUpperCase();

  // [최우선] 특정 리그 예외 조건 확인
  if (leagueCountryOverrides[upperLeagueName]) {
    country = leagueCountryOverrides[upperLeagueName];
  } 
  // [2순위] 원본 데이터가 WORLD나 INTERNATIONAL인 경우
  else if (["WORLD", "INTERNATIONAL"].includes(match.country?.toUpperCase())) {
    country = "국제";
  } 
  // [3순위] 그 외에는 AI 번역값이나 기존 데이터 사용
  else {
    country = aiCountryName || match.countryKor || match.country;
  }

  // 4순위: 만약 AI 번역값이 영어이거나 없을 경우 기본값/매핑값 사용
  if (!country || /^[a-zA-Z\s]+$/.test(country)) {
      country = countryMap[countryRaw] || match.countryKor || match.country;
  }
  
  if (['MLB', 'NBA', 'NHL', 'MLS'].some(lg => leagueName.toUpperCase().includes(lg))) country = "미국";
  if (['KBO', 'KBL', 'V-LEAGUE', 'LCK'].some(lg => leagueName.toUpperCase().includes(lg))) country = "대한민국";
  if (leagueName.includes("영국") || aiHomeName.includes("영국")) country = "영국";
  if (leagueName.includes("이탈리아") || aiHomeName.includes("이탈리아")) country = "이탈리아";

  // 5. [강제집행] 본문 내 영문 팀명 전역 치환 (본문 읽기 편하게) (팀명이 자꾸 영어로 번역되서 임시로 가림)
  // cleanedText = cleanedText.replace(new RegExp(match.home, 'gi'), aiHomeName);
  // cleanedText = cleanedText.replace(new RegExp(match.away, 'gi'), aiAwayName);

  // 6. [강제집행] 경기 정보 요약 표 (디자인 강제 고정)
  const spacer = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
  const summaryTable = `### 🏟️ 경기 정보 요약
| <span style="color: #007bff;">항목</span>| <span style="color: #007bff;">내용</span> |
|:---|:---|
| **<span style="color: #007bff;">홈팀</span>** | <img src="${match.homeLogo}" width="31" height="30" style="vertical-align: middle;"> **${aiHomeName}** |
| **<span style="color: #007bff;">원정팀</span>** | <img src="${match.awayLogo}" width="31" height="30" style="vertical-align: middle;"> **${aiAwayName}** |
| **<span style="color: #007bff;">리그</span>** | **${country}: ${leagueName}** |
| **<span style="color: #007bff;">경기시간</span>** | **${new Date(match.date).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })}** |`;

  // 7. 기존 AI 요약 전체 삭제
cleanedText = cleanedText.replace(/### 🏟️ 경기 정보 요약[\s\S]*?(?=###|$)/, "").trim();
 // 8. 맨 위에 강제 삽입
cleanedText = summaryTable + "\n\n" + cleanedText;

  // 9. 추천픽 표 정제 - 미스트랄 예외 완벽 방어
if (cleanedText && cleanedText.includes('🎯 추천픽')) {
  let parts = cleanedText.split(/🎯 추천픽|### 🎯 추천픽/);

  // 🔥 여기 추가된 핵심 방어
  if (!Array.isArray(parts) || parts.length < 2) {
    console.warn("⚠️ 추천픽 파싱 불가: 구조 이상");
  } else {
    let pickBody = parts[parts.length - 1]?.trim() || "";

    const rows = pickBody.split('\n')
      .map(line => line.trim())
      .filter(line => line && line.includes('|') && !line.includes(':---'));

    if (rows.length > 0) {
      const emptyHeader = "| | | |\n|---|---:|---:|"; 
      const cleanRows = rows.map(r => r.replace(/\|+/g, "|")).join('\n');
      pickBody = emptyHeader + "\n" + cleanRows;
    }

    cleanedText = parts[0].trim() + "\n\n### 🎯 추천픽\n\n" + pickBody;
  }
}

  // 10. 제목 및 저장
  const finalTitle = `${dateShort} ${country} [${leagueName}] ${aiHomeName} vs ${aiAwayName} 분석`;
    // 본문 내부에 AI가 임의로 작성한 제목 행(26/05/01... 분석)이 중복 노출되지 않도록 제거
  cleanedText = cleanedText.replace(new RegExp(`${dateShort}.*?분석`, 'g'), '').trim();
  const catNames = { "soccer": "축구", "basketball": "농구", "baseball": "야구", "volleyball": "배구", "hockey": "하키", "lol": "롤" };
  const korCat = catNames[cat] || "스포츠";

  const footer = `\n<div align="center">\n<p><b>© 픽천국(Pick Heaven)</b></p>\n<p>- 무료로 제공되는 참고용 스포츠분석 글이며, 결과에 책임지지 않습니다 -</p>\n<hr>\n#${aiHomeName.replace(/\s+/g, '')} #${aiAwayName.replace(/\s+/g, '')} #오늘 #스포츠픽 #스포츠분석\n</div>`;

 // 팀명을 포함하여 고유성을 보장 (safeHomeName 활용)
const safeHomeNameForSlug = getSafeLogoName(match.home); 
const content = `---
title: "${finalTitle}"
date: ${match.date}
description: "${extractedDesc.replace(/"/g, "'")}"
slug: "analyze-${match.id}-${dateOnly}-${safeHomeNameForSlug}"
category: "${cat}"
country: "${country}"
league: "${leagueName}"
homeTeam: "${aiHomeName}"
awayTeam: "${aiAwayName}"
homeLogo: "${match.homeLogo}",
  awayLogo: "${match.awayLogo}",
---

${cleanedText}${footer}`;

  fs.writeFileSync(savePath, content, 'utf8');
  console.log(`✅ [저장성공] ${finalTitle}`);
}

analyzeMatches();