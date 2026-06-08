import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- [ 설정 구역: 여기에 발급받은 키들을 정확히 넣으세요 ] ---
const ROUTERONE_API_KEY = process.env.ROUTERONE_KEY;

// API 키가 누락되었을 경우 에러 발생 및 자동 종료 처리
if (!ROUTERONE_API_KEY) {
  console.error("❌ 에러: ROUTERONE_KEY 환경 변수가 설정되지 않았습니다.");
  console.error("GitHub Repository Settings -> Secrets and variables -> Actions에서 등록했는지 확인하세요.");
  process.exit(1);
}

// [추가] 특정 팀명을 원하는 이름으로 고정하는 매핑 테이블
const TEAM_NAME_MAP = {
  "KFUM Oslo": "KFUM 오슬로",
  "Manchester City": "맨시티",
  "Tottenham": "토트넘",
  "Bodo/Glimt": "보되/글림트",
  "Al-Ettifaq": "알 에티파크",
  "Genk": "헹크",
  "Auxerre": "옥세르",
  "Yongin City": "용인 FC",
  "Uni Lions": "유니 라이온즈",
  "Chinatrust Brothers": "중신 브라더스",
  "St.Louis Cardinals": "세인트루이스 카디널스",
  "Detroit Tigers": "디트로이트 타이거즈",
  "Toronto Blue Jays": "토론토 블루제이즈",
  "Baltimore Orioles": "볼티모어 오리올스",
  "New York Mets": "뉴욕 메츠",
  "New York Yankees": "뉴욕 양키즈",
  "Hiroshima Carp": "히로시마 도요 카프",
  "Seattle Mariners": "시애틀 마리너스",
  "Qingdao Jonoon": "칭다오 하이뉴",
  "Shenyang Urban": "랴오닝 선양",
  "Wuhan Three Towns": "우한 쓰리 타운즈",
  "Los Angeles Angels": "LA 에인절스",
  "Athletics": "애슬레틱스",
  "Seibu Lion": "세이부 라이온즈",
  "Orix Buffaloes": "오릭스 버팔로스",
  "Wei Chuan Dragons": "웨이촨 드래곤스",
  "TSG Hawks": "TSG 호크스",
  "Rakuten Monkeys": "라쿠텐 몽키스",
  "Fubon Guardian": "푸방 가디언즈",
  "Pittsburgh Pirates": "피츠버그 파이러츠",
  "Nippon Ham Fighters": "니혼햄 파이터즈",
  "Nieciecza": "부르크베트 테르말리차",
  "Lechia Gdansk": "레히아 그단스크",
  "Widzew Łódź": "비드제브 로즈",
  "Xac Broncos": "Xac 브롱코스",
  "Ventforet Kofu": "방포레 고후",
  "Công An Nhân Dân": "하노이 폴리스",
  "Meizhou Kejia": "메이저우 하카",
  "Taipower": "대만전력",
  "Tatung": "래퍼드 캣 FC",
  "Meshakhte": "마사크테 트빌리시",
  "Universitatea Craiova": "Univ 크라이오바",
  "Toledo Mud Hens": "톨레도 머드헨스",
  "NC Dinos": "NC 다이노스",
  "LG Twins": "LG 트윈스",
  // 필요한 팀명을 여기에 계속 추가하세요. "원래이름": "바꿀이름"
};

// [추가] 팀명을 LOL 로고 파일명 규칙으로 안전하게 변환
function getSafeLogoName(teamName) {

  if (!teamName) return "default-logo";

  return String(teamName)
    .trim()                         // 앞뒤 공백 제거
    .toLowerCase()                  // 소문자
    .replace(/[\/\\]/g, '-')        // 슬래시 → -
    .replace(/\./g, '-')            // 점(.) → -
    .replace(/\s+/g, '-')           // 공백 → -
    .replace(/[^a-z0-9-]/g, '')     // 영문/숫자/- 제외 제거
    .replace(/-+/g, '-')            // 중복 하이픈 제거
    .replace(/^-+|-+$/g, '');       // 앞뒤 하이픈 제거
}

// 최근 경기 → AI 컨텍스트 + 가로 한줄 형식
  function buildRecentForm(recentList, teamName) {
  if (!recentList || recentList.length === 0) return `${teamName}: 최근 경기 데이터 없음`;

  const lines = recentList.map(m => {
    const d = new Date(m.date).toLocaleDateString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit'
    }).replace(/\.\s*/g, '/').replace(/\/$/, '');
    const score = (m.homeScore !== null && m.awayScore !== null)
      ? `${m.homeScore}-${m.awayScore}` : m.score;
    const isHome = m.home === teamName;
    const myScore = isHome ? Number(m.homeScore) : Number(m.awayScore);
    const opScore = isHome ? Number(m.awayScore) : Number(m.homeScore);
    const result = myScore > opScore ? '🟢승' : myScore < opScore ? '🔴패' : '🟡무';
    return `${d} ${m.home} vs ${m.away} (${score}) → ${result}`;
  });

  const wins = recentList.filter(m => {
    const isHome = m.home === teamName;
    const my = isHome ? Number(m.homeScore) : Number(m.awayScore);
    const op = isHome ? Number(m.awayScore) : Number(m.homeScore);
    return my > op;
  }).length;
  const losses = recentList.filter(m => {
    const isHome = m.home === teamName;
    const my = isHome ? Number(m.homeScore) : Number(m.awayScore);
    const op = isHome ? Number(m.awayScore) : Number(m.homeScore);
    return my < op;
  }).length;
  const draws = recentList.length - wins - losses;

  const totalScored = recentList.reduce((sum, m) => {
    const isHome = m.home === teamName;
    return sum + (isHome ? Number(m.homeScore) : Number(m.awayScore));
  }, 0);
  const avgScore = (totalScored / recentList.length).toFixed(1);

  const summary = `최근 ${recentList.length}경기: ${wins}승 ${draws}무 ${losses}패 / 평균 득점 ${avgScore}`;
  const matchLines = lines.join('  \n');

  return `${summary}\n\n📋 최근 경기\n\n${matchLines}\n\n`;
}

async function analyzeMatches() {
  try {
    const today = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
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
  'K4','FOOTBALL LEAGUE', 'THAILAND', 'MALAYSIA', 'INDONESIA', 'Two', 'Birinci', 'Tasmania Northern Championship', 'Southern Championship', 'Queensland Premier League', 'V.League 2', 'Liga 2', 'I-League',
    // 브라질 및 남미 컵대회/지역리그 (South America & Cups)
  'CAMPEONATO', 'COPA DO NORDESTE', 'COPA VERDE', 'COPA ESPÍRITO SANTO', 'COPA CENTRO-OESTE', 'COPA SUL-SUDESTE', 'COPA NORTE', 'PAULISTA', 'CARIOCA', 'MINEIRO', 'GAUCHO', 'PARANAENSE', 'BAIANO', 'PERNAMBUCANO', 'CATARINENSE', 'Copa do Nordeste', 'Copa Norte', 'Copa Presidente', 'Centro-Oeste', 'Copa Centro-Oeste', 'Copa Sul-Sudeste', 'Sul-Sudeste',
  'GOIANO', 'CEARENSE','LIGA PRO SERIE B', 'Liga Pro Serie B', 'Primera B', 'Sudamericana', 'Copa De La Liga', 'Serie B', 'Copa Do Brasil', 'Expansion MX', 'Copa Espírito Santo', 'Santo',
    // 아프리카 및 기타 국가 (Africa & Others)
  'EGYPT', 'SOUTH AFRICA', 'TUNISIA', 'MOROCCO', 'UGANDA', 'BOTOLA', 'Elite Two', 'Coupe Nationale', 'Ligue 2', 'Second League',
    // 유럽 기타 국가 및 리그 (Europe Others)
  '1. DIVISION', 'FEDERACION', 'SUPER LEAGUE 2', '2. Deild', '3. Division', '3. Division - Girone 6', 'UEFA Europa Conference League', 'Ykkösliiga', 'Kakkonen - Lohko C', 'Kakkonen - Lohko A', 'Kakkonen - Lohko B', 'Kakkonen', 'Superettan', 'Ettan - Södra', 'Ettan - Norra', 'Ettan', 'Division 2 - Norra Götaland', 'Division 2 - Östra Götaland', 'Götaland', 'Division 2 - Västra Götaland', 'Damallsvenskan', 'Division 2 - Norrland', 'First Division',
  'U18 PREMIER LEAGUE', 'PREMIER LEAGUE INTERNATIONAL CUP', 'Elitettan', 'Damallsvenskan', 'Ettan', 'Svealand', 'Prime League', 'North American', 'NWSL', 'Central', 'MLS Next Pro',
    // 농구 및 기타 (Basketball & Others)
  'ABA LEAGUE', 'USL CHAMPIONSHIP', 'BAHRAIN', 'Balkan', 'HLL', 'LES', 'Circuito', 'LRS', 'Legends',  'ACB', 'NBL', 'USHL', 'SHL', 'Liiga', 'DEL', 'SuperLega', 'PlusLiga', 'LFL', 'Prime League', 'Arabian League', 'TCL', 'Regular', 'LIT', 'BSN', 'LNB', 'LBP', 'PCL', 'SPHL', 'ECHL', 'Regular Season', 'LPLOL Regular Season', 'LPLOL REGULAR SEASON','Esports World Cup Playoffs','ESPORTS WORLD CUP PLAYOFFS',
];

  // ⬇️ 제외하고 싶은 국가명을 정확히 입력하세요 //대소문자 구분없음
    const blockedCountries = [
  "Bahrain", "Kyrgyzstan", "Uzbekistan", "Uganda", "Eswatini", "Zambia", "India", "South-Africa", "Malaysia", "Malta", "Kenya", "Barbados", "Peru", "Bolivia", "Honduras", "Cambodia", "Ivory-Coast", "Cyprus", "Burkina-Faso", "Azerbaijan", "Belarus", "Kazakhstan", "Ukraine", "Zimbabwe", "Rwanda", "Congo", "Mongolia", "Armenia", "Indonesia", "Syria", "Ethiopia", "Chile", "Ecuador", "Lithuania", "Mauritania", "Latvia", "Estonia", "Balkans", "Puerto Rico", "Dominican Republic", "Aruba", "Philippines", 'PERU', 'ECUADOR', 'AZERBAIJAN', 'ARMENIA', 'BELARUS', 'KAZAKHSTAN', 'UKRAINE', 'ICELAND', 'LITHUANIA', 'LATVIA', 'ESTONIA', 'MALTA', 'CYPRUS', 'SYRIA', 'BARBADOS', 'Bangladesh', 'Tunisia', 'Malawi', 'Ghana', 'Lebanon', 'Botswana',
  "Slovakia", "Faroe-Islands", 'Aruba', 'Panama', 'Bhutan', 'Ethiopia', 'Congo-DR', 'Israel', "El Salvador", 'El-Salvador', 'Jamaica', 'Rwanda', 'Mauritania', 'Zimbabwe',,'Ethiopia', 'Kenya', 'INDIA', 'UZBEKISTAN', 'KYRGYZSTAN', 'Bangladesh', 'Lesotho', 'Kuwait', 'Finland',
].filter(c => c !== "South-Korea");

    const blockedTeams = [
  // [나이,성별]
  'U21', 'U19', 'U18', 'U17', 'YOUTH', 'RESERVE', 'WOMEN', 'WOMAN', 'FEMALE', 'FRAUEN', 'FEMININE', 'FEMININE DIVISION 1', 'FEMENIL', 'BUBLIKI', 'ZEROZONE GAMING', 'RONALDO TEAM', 'THE OTTER SIDE', 'CRUSADERS', 'DREAM ESPORTS', 'GTZ ESPORTS', 'FLUXO W7M', 'PAIN GAMING', 'LOUD', 'VIVO KEYD STARS', 'RED CANIDS', 'LEVIATAN ESPORTS', 'FRITES ESPORTS CLUB', 'MCON ESPORTS',
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

  // 1. 여기에 예외로 허용하고 싶은 여성/청소년 리그명을 대문자로 등록합니다.
const allowedWomenLeagues = ['AFC WOMEN\'S CHAMPIONS LEAGUE','NATIONS LEAGUE WOMEN','EUROPEAN LEAGUE WOMEN'];
const isAllowedWomenLeague = allowedWomenLeagues.some(el => el === upperLg);

  // [단계 1] 가장 먼저 여성/청소년 경기인지 확인 (최우선순위) - 있으면 무조건 차단
  const isRestricted = !isEssentialTeam && !isAllowedWomenLeague && (upperLg.includes('WOMEN') || upperLg.includes('FRAUEN') || upperLg.includes('YOUTH') || upperLg.includes('RESERVE') || upperLg.includes('U15') || upperLg.includes('U16') || upperLg.includes('U17') || upperLg.includes('U18') || upperLg.includes('U19') || upperLg.includes('U20') || upperLg.includes('U21') || upperLg.includes('U23'));

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
    "Saudi-Arabia": ["DIVISION 1"],    
    "Egypt": ["CUP"],
    "Venezuela": ["SEGUNDA DIVISIÓN"],
    "Uruguay": ["SEGUNDA DIVISIÓN"],
    "USA": ["USL LEAGUE ONE"],
    "England": ["LEAGUE ONE"],
  };

  if (countryLeagueBlacklist[country] && countryLeagueBlacklist[country].some(bl => cleanUpperLg.includes(bl.replace(/\s+/g, '').toUpperCase()))) {
    console.log(`🚫 [특수 차단] ${country} 하위 리그 스킵: ${m.league}`);
    return false;
  }

  // 프리패스 리그 작성 구간 (프리패스 리그는 전부 무조건 대문자로 적어야 함)  
  // 1. 축구 주요 리그 
  const top5 = ['PREMIER LEAGUE', 'CHAMPIONSHIP', 'LA LIGA', 'SEGUNDA DIVISIÓN', 'BUNDESLIGA', '2. BUNDESLIGA', 'PRIMEIRA LIGA', 'SERIE A', 'SERIE B', 'LIGUE 1', 'LIGUE 2', 'EREDIVISIE'].some(el => el === upperLg);
  const korea = ['KLEAGUE1', 'KLEAGUE2'].some(el => {
  const cleanLg = upperLg.replace(/\s+/g, ''); // 데이터의 모든 공백 제거
  return el === cleanLg;
});
  const mls = ['MAJOR LEAGUE SOCCER', 'MLS'].some(el => el === upperLg); // NEXT PRO는 이름이 다르므로 자동 차단됨
  // 국대 경기 및 컵대회 (키워드 특성상 includes 유지하되 NEXT PRO 등은 위에서 차단됨)
  const isMainInternational = ['FRIENDLY INTERNATIONAL', 'WORLD CUP', 'EURO', 'COPA AMERICA', 'AFC ASIAN CUP', 'OLYMPIC', 'UEFA','CONCACAF CHAMPIONS LEAGUE', 'OFC PRO LEAGUE', 'CONMEBOL LIBERTADORES', 'Copa Libertadores'].some(el => upperLg.includes(el));
    // 1부 리그 명칭들 (완전 일치로 변경하여 잡리그 방어)
  const isFirstDivision = ['DIVISION 1', '1 DIVISION', 'PREMIER DIVISION', 'PREMIERSHIP', 'SUPER LEAGUE', 'PRO LEAGUE', 'PREMIER', 'A LEAGUE', 'JUPILER PRO LEAGUE', 'ELITESERIEN', 'AFRICAN CLUB CHAMPIONSHIP', 'PFL', 'AFC U17 ASIAN CUP', 'J1 LEAGUE', 'VEIKKAUSLIIGA', 'ALLSVENSKAN', 'HNL','J2/J3 LEAGUE', 'PRIMERA DIVISIÓN - APERTURA', "AFC WOMEN'S CHAMPIONS LEAGUE", 'A-LEAGUE', 'EKSTRAKLASA', 'LEAGUE ONE', 'V.LEAGUE 1', 'LIGA I', 'TAIWAN FOOTBALL PREMIER LEAGUE', 'EROVNULI LIGA','DFB POKAL', 'CONMEBOL SUDAMERICANA','WK-LEAGUE','PRIMERA A'].some(el => el === upperLg);

  // 축구 통합 필터
  const soccerFilter = (sport === 'soccer') && !isRestricted && (top5 || korea || mls || isMainInternational || isFirstDivision);

  // 2. 농구 
  const basketball = ['KBL', 'WKBL', 'CBA', 'B.LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'B LEAGUE', 'NBA', 'ASIA CHAMPIONS LEAGUE', 'EUROLEAGUE','NBA W'].some(el => el === upperLg);
  // 3. 배구 
  const volleyball = ['V-LEAGUE', 'KOVO', 'KOREA V', 'V.LEAGUE', 'SUPER LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'FRIENDLY INTERNATIONAL', 'SV.LEAGUE','NATIONS LEAGUE WOMEN','NATIONS LEAGUE','EUROPEAN LEAGUE WOMEN','EUROPEAN LEAGUE'].some(el => el === upperLg);
  // 4. 야구 
  const baseball = ['KBO', 'MLB', 'NPB', 'CPBL', 'ABL', 'WORLD', 'WORLDS', 'INTERNATIONAL'].some(el => el === upperLg);
  // 5. 하키 
  const hockey = ['NHL', 'KHL', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'BEIJER HOCKEY GAMES', 'WCH U18', 'WORLD CHAMPIONSHIP' ].some(el => el === upperLg);
  // 6. 롤 //대문자로 띄어쓰기 없이 적을 것. Rounds 1-2 이런 글자는 자동 삭제니 적지 않아야 함
  // Playoffs가 붙은 EWC는 lol 판별 전에 먼저 차단
  const isEWCPlayoffs = upperLg.replace(/\s+/g, '') === 'ESPORTSWORLDCUPPLAYOFFS';
  if (isEWCPlayoffs) {
    console.log(`🚫 [EWC 차단] EWC Playoffs 스킵: ${m.league}`);
    return false;
  }

  const normalizedLg = upperLg
  .replace(/\s+/g, '')
  .replace(/ROUNDS?.*|WEEK.*|GROUP.*|STAGE.*|PLAYOFFS?.*/i, '');
  const lol = ['LCK','LCK CL','LPL', 'LCS','LEC', 'MSI','WORLD','WORLDS','INTERNATIONAL','ESPORTSWORLDCUP','LCKCHALLENGERSLEAGUE'].includes(normalizedLg);

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


    console.log(`🚀 [픽천국 엔진] ${today} 총 ${filteredMatches.length}개 분석 시작 (Gemini 2.5 flash)`);

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

  // 2. 리그명 교정 로직
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

      // 4. 로고 매칭
  if (match.sport === "lol") {
  const homeFile = getSafeLogoName(match.home);
  const awayFile = getSafeLogoName(match.away);

  const homePath = path.resolve(__dirname, '../public/logos', `${homeFile}.png`);
  const awayPath = path.resolve(__dirname, '../public/logos', `${awayFile}.png`);

  match.homeLogo = fs.existsSync(homePath)
    ? `/logos/${homeFile}.png`
    : '/images/wing-home.png';

  match.awayLogo = fs.existsSync(awayPath)
    ? `/logos/${awayFile}.png`
    : '/images/wing-away.png';
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

  // 최근 3경기 추출
  const homeRecentMatches = masterData.filter(m => {
    const isHomeTeam = m.home === match.home || m.away === match.home;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                     (m.homeScore !== null && m.awayScore !== null);
    return isHomeTeam && isPast && isRecentEnough && hasScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

  // 원정팀 최근 3경기 추출
  const awayRecentMatches = masterData.filter(m => {
    const isAwayTeam = m.home === match.away || m.away === match.away;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                     (m.homeScore !== null && m.awayScore !== null);
    return isAwayTeam && isPast && isRecentEnough && hasScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

  // ✅ 최근 경기 컨텍스트 문자열 생성
  const homeRecentContext = buildRecentForm(homeRecentMatches, match.home);
  const awayRecentContext = buildRecentForm(awayRecentMatches, match.away);

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
      lg.includes('LCK') || lg.includes('LEC') || lg.includes('MSI') || lg.includes('WORLDS')
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

    const aiHomeName = TEAM_NAME_MAP[match.home] || match.home;
    const aiAwayName = TEAM_NAME_MAP[match.away] || match.away;

    const gameContext = cat === 'lol' ? "이 경기는 '리그오브레전드(롤)' 이스포츠 경기다. 절대 농구나 축구로 착각하지 마라." : "";

// 1. 절대로 변하지 않는 '절대 규칙/지시문'만 시스템 프롬프트로 고정합니다. (캐싱 대상)
const SYSTEM_RULES_PROMPT = `
  너는 '픽천국'의 수석 분석가야. 아래 규정을 절대적으로 준수하여 풍부하고 냉철한 리포트를 작성해라.

  [최우선 지시: 영문 노출 절대 금지]
  - 모든 팀명은 반드시 한국어로만 작성해야 한다.
  - 만약 네가 팀명의 정확한 한글 명칭을 모른다면, 영문 스펠링을 한글 소리 나는 대로 적어라.
  - 'AS', 'DN', 'BNK','TS', 'FC', 'AC', 'SK', 'U20', 'KT' 같은 영문 약자는 번역하지 말고 영문 그대로 유지해라.
  
  [금지 사항]
  1. 한자(한문), 일어 사용 절대 금지: 100% 쉬운 한글로만 작성.
  2. 추천픽에 배당은 기재하면 안된다.
  3. 반드시 제공된 "JSON 데이터"의 팀명만 사용하세요. ...
  4. 보고서의 어떤 항목에서도 영문 팀명을 그대로 노출하지 마라. ...
  5. 홈팀명, 원정팀명, 리그명, 국가명 단어 자체에 ** 기호를 감싸거나 남발하지 마십시오.
  6. '경기 정보 요약' 섹션을 절대 직접 작성하지 마라. 이 섹션은 시스템이 자동 삽입한다.
  7. 날짜/홈팀/원정팀/리그를 텍스트로 나열하는 블록을 절대 작성하지 마라.
  8. '### 🏟️ 경기 정보 요약' 섹션은 시스템이 자동 삽입하므로 직접 작성 금지.

  [팀명 한글화 절대 원칙]
  1. 처리 순서: 분석을 시작하기 전, 제공된 영문 팀명을 가장 먼저 표준 한국어 명칭으로 변환하라.
  2. 모든 팀 이름은 반드시 한글로만 작성하세요.
  3. 모든 팀 이름은 한글 소리 나는 대로 번역해라. (예: Arsenal -> 아스널)
  4. 적용 범위: 변환된 한글 팀명을 TITLE, 경기 정보 요약 표, 각 섹션의 부제목, 추천픽 표 등 보고서 전체에 100% 적용하라.
  5. 팀명 뒤 'U20', 'W' 등이 있다면 반드시 한글 뒤에 붙여라.

  [출력 강제 규칙]
  - 반드시 아래 형식의 데이터를 최상단에 추가 출력하라. 이 값이 없으면 전체 응답은 실패로 간주된다.
  HOME_KOR: (홈팀 한글명)
  AWAY_KOR: (원정팀 한글명)
  COUNTRY_KOR: (국가명 한글명)
  
  [디자인 지시]
  1. 부제목 아이콘: 🏟️, ⚔️, 📝, 🎯 필수.
  2. 팀별 분석에 현재 리그 순위와 시즌 성적을 반드시 1문장 이상 작성하라.
  3. 최근 경기력, 공격력, 수비력, 홈/원정 성적, 상대전적 중 최소 3가지 요소를 활용하여 3문장 이상 분석하라.
  4. 결장자 정보는 구글 검색으로 반드시 확인하라.
   - 검색으로 확인된 실제 결장자가 있으면 이름과 사유를 1문장으로 작성하라.
   - 검색해도 결장자 정보를 확인할 수 없으면 "현재 주요 결장자 정보는 확인되지 않습니다."라고만 적어라.
   - 절대로 선수 이름을 추측하거나 [가상 선수명] 같은 플레이스홀더를 작성하지 마라.
  5. 팀별 분석은 위 지시사항을 포함해서 최소 5문장 이상 작성하라.
  6. 문맥상 마침표가 나오거나 주제가 바뀌면 반드시 <br> 태그와 함께 다음 줄로 넘겨라.
  7. 모든 추천픽의 기준점(핸디캡, 오버언더)은 제공된 팀의 전력과 최근 득점력을 바탕으로 네가 직접 '가장 적절한 수치'를 산출해서 [추천 픽 및 기준점] 테이블을 만드세요.
  8. 상대전적은 구글 검색(Google Search)을 기능을 총동원하여 최대 5개까지 최신순으로 찾아내되, 연도가 2024년, 2025년, 2026년인 기록만 출력하라.
    - 2023년 포함 그 이전(2023, 2022, 2021 등)의 과거 데이터는 검색 결과에 있더라도 절대로 리스트에 포함하지 말고 제외하라.
    - 조건에 맞는 최근 2년 이내(2024~2026) 기록이 단 하나도 없다면, 이 섹션 전체를 출력하지 말고 '※업데이트 예정'이라고만 표기하라.  
  9. 리그명 중 KBL, MLB, NPB, NHL, MLS, KHL 등 약자로 된 리그는 한글로 바꾸지말고 영문 그대로 사용해주세요.
  10. 출력 시 반드시 최종 분석 보고서 결과만 출력하고, 내부 추론 과정이나 검색 결과에 대한 코멘트, 불필요한 기호는 절대 포함하지 마세요.
  11. 홈팀 분석 텍스트 안에 반드시 다음 두 가지를 포함하라:
    ① 제공된 [홈팀 최근 3경기 DB]의 승/패 기록과 평균 득점 수치를 인용하여 최근 폼을 1~2문장으로 서술하라.
       (예: "최근 3경기에서 2승 1패를 기록 중이며, 평균 2.3득점을 올리고 있어 공격력이 살아있는 상태다.")
    ② 분석 텍스트가 끝난 다음 줄에, 아래 형식을 그대로 사용하여 최근 경기를 출력하라.
       표(|) 절대 사용 금지. 한 경기당 한 줄씩 출력하라.

       📋 최근 경기
       YY/MM/DD 팀A vs 팀B (X-Y) → 🔴패
       YY/MM/DD 팀A vs 팀B (X-Y) → 🟢승
       YY/MM/DD 팀A vs 팀B (X-Y) → 🟡무
       (위 형식은 예시이며, 반드시 [홈팀/원정팀 최근 3경기 DB]에서 제공된 실제 데이터만 사용하라. 예시 값을 절대 그대로 출력하지 마라.)

       - 승/무/패 이모지 규칙: 승 → 🟢승, 패 → 🔴패, 무 → 🟡무
       - 팀명은 반드시 한글로 번역하라.
       - 데이터가 없으면 '📋 최근 경기 데이터 없음'으로 표기하라.
12. 원정팀도 11번과 동일한 규칙을 적용하라.

  [제목 형식 지시] 
  - 상단 TITLE 라인의 팀명은 반드시 한글로 번역해서 사용해라.
  - 제목에 임의로 이모지를 넣지 말아라.
                          
  [절대 규칙 - 위반 시 실패로 간주]
  1. 리그명 치환 규칙을 반드시 적용하지 않으면 출력 전체가 무효 처리된다.
  2. 분석 과정, 내부 추론, 모델의 자기 생각(Thought)을 본문에 단 한 단어도 포함하지 마라.
  3. 응답은 반드시 HOME_KOR / AWAY_KOR / COUNTRY_KOR 세 줄 다음,
   '### <img ...> 홈팀명 분석' 섹션부터 바로 시작하라.
  4. 한국어 분석 리포트 내에 영어로 된 설명글이나 메모를 절대 적지 마라. 100% 한국어만 사용해라.
  5. 동일한 내용을 두 번 반복해서 생성하는 행위는 절대 금지한다.

  [종목별 작성 지침 - 절대 엄수]
  - 카테고리가 'lol'일 경우: '득점', '슛', '홈 이점', '오버/언더 100점대' 사용 절대 금지.
  - 대신 '킬', '데스', '오브젝트(용, 바론)', '라인전', '한타', '밴픽' 용어를 사용하여 3문장 이상 작성할 것.
  - 추천픽 기준점도 롤은 보통 2.5(세트 기준) 내외이므로, 100점 단위의 농구 기준점 출력 시 즉시 에러로 간주함.
 
  [팀 분석 섹션 작성 규칙]
반드시 아래 형식을 그대로 따르라. 헤더에 <img> 태그가 먼저, 그 다음 팀명이 온다.

올바른 형식:
### <img src="[홈팀 로고 URL]" width="30" height="30" style="vertical-align: middle;"> [홈팀명] 분석
분석 첫 문장<br>
분석 두 번째 문장<br>
<br><br>

### <img src="[원정팀 로고 URL]" width="30" height="30" style="vertical-align: middle;"> [원정팀명] 분석
분석 첫 문장<br>
분석 두 번째 문장<br>
<br><br>

절대 금지:
- ### 팀명 분석 (img 없이 팀명만 쓰는 것)
- ### 팀명 분석 다음 줄에 <img> 태그 쓰는 것
- 헤더와 <img> 사이에 어떤 텍스트도 삽입 금지

  ### ⚔️ 상대전적
  [상대전적 작성 절대 규칙]
  1. 마크다운 표(|)를 절대 사용하지 마라. 대신 아래 형식을 엄수하여 '한 줄에 하나씩' 불렛 포인트로 작성하라.
  2. 야구 분석 시 '무승부' 결과가 나오면 데이터 오류이므로 다시 찾아라.
  3. 상대전적은 구글 검색(Google Search)을 기능을 총동원하여 최대 5개까지 최신순으로 찾아내되, 연도가 2024년, 2025년, 2026년인 기록만 출력하라.
    - 2023년 포함 그 이전(2023, 2022, 2021 등)의 과거 데이터는 검색 결과에 있더라도 절대로 리스트에 포함하지 말고 제외하라.
    - 조건에 맞는 최근 2년 이내(2024~2026) 기록이 단 하나도 없다면, 이 섹션 전체를 출력하지 말고 '※업데이트 예정'이라고만 표기하라.  

  [상대전적 출력 예시]
  ### ⚔️ 상대전적
  * 년.월.일 - 홈팀한글명 (1-2) 원정팀한글명 
  * 년.월.일 - 홈팀한글명 (4-2) 원정팀한글명 
  <br><br>

  ### 📝 종합 분석
  (상대전적 유무와 상관없이 현재 폼을 바탕으로 한 최종 진단) 
  <br><br>

  ### 🎯 추천픽
  [추천픽 작성 규칙]
  1. 표의 헤더와 구분선을 절대 작성하지 마세요. 오직 내용이 담긴 행만 출력하세요.
  2. 기준점 직접 산출: 모든 추천픽의 기준점은 제공된 전력을 바탕으로 네가 직접 '가장 적절한 수치'를 산출해서 표기하라.
  3. 이모지/기호 금지: ⚾, ⚽ 등 이모지는 절대 사용하지 마라.
  4. 아래의 텍스트 형식을 그대로 사용하여 3줄의 데이터만 출력하세요.
  5. 너의 검색기능을 활용해서 배당을 찾은 후에 그 정보를 바탕으로 추천픽을 작성할 것.
  6. 배구 오버언더는 세트스코어 기준으로 추천값을 작성할 것.
  7. 핸디캡 추천 기준점은 승무패 추천팀과 같은 팀을 기준으로 작성할 것.
  8. 승무패는 승리팀을 기준으로 작성할 것.

  | 승무패 | [추천팀 한글명] | [승/무/패] |
  | 핸디캡 | [추천팀 한글명] | [수치] |
  | 오버언더 | [오버/언더] | [수치] |
  <br>&nbsp;
`;

// 2. 매 경기 실시간으로 변경되는 데이터만 User 프롬프트로 묶어줍니다.
const matchDataPrompt = `
  [실시간 경기 컨텍스트 데이터]
  - 종목 안내: ${gameContext}
  - 날짜/시간 변수 고정값: 날짜는 반드시 '${dateShort}' 값 그대로 사용할 것.
  - 홈팀 정보: 한글 매핑명 명칭은 '${aiHomeName}'이며, 오리지널 영문명은 '${match.home}'이다. 로고 태그는 '<img src="${match.homeLogo || ''}" width="30" height="30" style="vertical-align: middle;">'를 사용하라.
  - 원정팀 정보: 한글 매핑명 명칭은 '${aiAwayName}'이며, 오리지널 영문명은 '${match.away}'이다. 로고 태그는 '<img src="${match.awayLogo || ''}" width="30" height="30" style="vertical-align: middle;">'를 사용하라.
  - 상대 전적 데이터베이스 정보: ${h2hContextForAI}
  - [중요] 상대전적 가이드: 데이터베이스에 스코어 정보가 있다면 이를 우선 반영하고 만약 비어있다면 Google Search를 통해 "${match.home} vs ${match.away} last match results 2024 2025 2026"를 검색하여 리포트를 완성하라.

    [홈팀 최근 3경기 DB - 홈팀 분석 섹션 하단에 반드시 반영]
  ${homeRecentContext}

  [원정팀 최근 3경기 DB - 원정팀 분석 섹션 하단에 반드시 반영]
  ${awayRecentContext}
`;

// ✅ 재시도 포함 버전 (최대 2회 시도)
let success = false;
const MAX_RETRY = 2;
const client = new OpenAI({ baseURL: "https://api.router.one/v1", apiKey: ROUTERONE_API_KEY });

for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
  try {
    if (attempt > 1) {
      console.log(`🔄 [재시도 ${attempt}/${MAX_RETRY}] ${match.home} vs ${match.away}`);
      await new Promise(res => setTimeout(res, 3000)); // 재시도 전 3초 대기
    }

    const completion = await client.chat.completions.create({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_RULES_PROMPT },
        { role: "user", content: matchDataPrompt }
      ]
    });

    const aiResponse = completion.choices?.[0]?.message?.content || "";

    if (aiResponse.length > 1200) {
      const saved = await savePost(savePath, aiResponse, match, dateShort, cat, dateOnly, h2hContent);
      if (saved) {
        console.log(`✅ Router One 성공 (${attempt}차 시도): ${match.home} vs ${match.away}`);
        success = true;
        break; // 성공하면 재시도 루프 종료
      } else {
        console.warn(`⚠️ [저장 실패] ${attempt}차 시도 저장 거부됨: ${match.home} vs ${match.away}`);
      }
    } else {
      console.warn(`⚠️ [응답 짧음] ${attempt}차 시도 응답 길이 부족 (${aiResponse.length}자): ${match.home}`);
    }

  } catch (err) {
    const code = err?.status || err?.response?.status;
    console.error(`❌ Router One 오류 (${code}) ${attempt}차 시도`, err.message);
    if (attempt === MAX_RETRY) break;
  }
}

if (success) {
  await new Promise(res => setTimeout(res, 6000));
} else {
  // ✅ 최종 실패 로그 기록
  const failLogPath = path.resolve(__dirname, '../database/failed-matches.log');
  const failEntry = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] FAILED: ${match.home} vs ${match.away} | ${match.league} | ${matchTimeStr}\n`;
  fs.appendFileSync(failLogPath, failEntry, 'utf8');
  console.error(`📋 [최종 실패 기록] ${match.home} vs ${match.away} → failed-matches.log`);

  // ✅ 실패 경기 빈 껍데기 파일 저장 (수동 재분석용)
  // 폴더 없으면 자동 생성
const failDir = path.resolve(__dirname, '../database/false');
if (!fs.existsSync(failDir)) fs.mkdirSync(failDir, { recursive: true });

const failSavePath = path.resolve(failDir, `${dateOnly}-${match.id}-${safeHomeName}.md`);
  if (!fs.existsSync(failSavePath)) {
    const aiHomeName = TEAM_NAME_MAP[match.home] || match.home;
    const aiAwayName = TEAM_NAME_MAP[match.away] || match.away;
    const failContent = `---
title: "[미분석] ${aiHomeName} vs ${aiAwayName} ${matchTimeStr}"
date: ${match.date}
description: "AI 분석 실패 - 수동 재분석 필요"
slug: "analyze-${match.id}-${dateOnly}-${safeHomeName}"
category: "${cat}"
country: ""
league: "${match.league}"
homeTeam: "${aiHomeName}"
awayTeam: "${aiAwayName}"
homeLogo: "${match.homeLogo || ''}"
awayLogo: "${match.awayLogo || ''}"
draft: true
---

> ⚠️ AI 분석 ${MAX_RETRY}회 시도 모두 실패한 경기입니다.

- 홈팀: ${aiHomeName} (${match.home})
- 원정팀: ${aiAwayName} (${match.away})
- 리그: ${match.league}
- 경기시간: ${matchTimeStr}
`;
    fs.writeFileSync(failSavePath, failContent, 'utf8');
    console.log(`📝 [미완성 파일 저장] ${match.home} vs ${match.away}`);
  }
}
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
    return false;
  }

  const basketballTerms = ["외곽슛", "득점력", "리바운드", "쿼터", "자유투", "3점슛"];
  if (cat === "lol" && basketballTerms.some(term => aiText.includes(term))) {
    console.error(`❌ [종목 혼동 차단] 롤 분석에 농구 용어 감지됨: ${match.home} vs ${match.away}`);
    return false; // 이 지점에서 함수를 종료하여 파일 생성을 막습니다.
  }

  // [검증 2] AI의 "방어적 사과문" 필터링
  if (aiText.includes("정보가 없") || aiText.includes("죄송합니다") || aiText.includes("불가능합니다")) {
    console.error(`❌ [분석 실패] AI가 유효하지 않은 답변을 생성함: ${match.home}`);
    return false;
  }

  // [검증 2-1] 가상 선수명 플레이스홀더 필터링
if (aiText.includes('[가상') || aiText.includes('선수명]') || aiText.includes('[부상') || aiText.includes('[결장')) {
  console.error(`❌ [환각 감지] 가상 선수명 플레이스홀더 발견: ${match.home}`);
  return false;
}

  // 1. 기초 정제 (여기서 변수를 선언합니다)
  let cleanedText = aiText.replace(/```markdown|```/g, "").trim();
  
  
// [검증 2-2] 야구 무승부 감지 필터
if (cat === "baseball") {
  const drawPattern = /\(\d+-\d+\).*무승부|\b(\d+)-\1\b/;
  const tieLines = cleanedText.split('\n').filter(line => {
    const scoreMatch = line.match(/\((\d+)-(\d+)\)/);
    return scoreMatch && scoreMatch[1] === scoreMatch[2];
  });
  if (tieLines.length > 0) {
    console.warn(`⚠️ [야구 무승부 감지] 해당 줄 자동 제거: ${match.home}`);
    cleanedText = cleanedText.split('\n')
      .filter(line => {
        const scoreMatch = line.match(/\((\d+)-(\d+)\)/);
        return !(scoreMatch && scoreMatch[1] === scoreMatch[2]);
      })
      .join('\n');
  }
}

  // 변수 선언 (중복 선언 에러 방지를 위해 여기서 한 번만 선언)
  const homeKorMatch = cleanedText.match(/HOME_KOR:\s*(.*)/);
  const awayKorMatch = cleanedText.match(/AWAY_KOR:\s*(.*)/);
  const countryKorMatch = cleanedText.match(/COUNTRY_KOR:\s*(.*)/);

  // [검증 3] 필수 정보(한글 팀명) 추출 확인
  if (!homeKorMatch || homeKorMatch[1].includes("정보 정보")) {
    console.error(`❌ [매핑 실패] 한글 팀명 누락으로 저장 스킵: ${match.home}`);
    return false;
  }

  // 데이터 할당
  const aiHomeName = homeKorMatch ? homeKorMatch[1].trim() : match.home;
  const aiAwayName = awayKorMatch ? awayKorMatch[1].trim() : match.away;
  const aiCountryName = countryKorMatch ? countryKorMatch[1].trim() : (match.countryKor || match.country);

  // 본문에서 메타 데이터 제거
  cleanedText = cleanedText.replace(/HOME_KOR:.*\n?/g, '');
  cleanedText = cleanedText.replace(/AWAY_KOR:.*\n?/g, '');
  cleanedText = cleanedText.replace(/COUNTRY_KOR:.*\n?/g, '');

   const catNames = { "soccer": "축구", "basketball": "농구", "baseball": "야구", "volleyball": "배구", "hockey": "하키", "lol": "롤" };
   const korCat = catNames[cat] || "스포츠";
  
  //  let 아랫줄부터 바로 위줄까지 코드 삽입으로 일단 임시로 가림
  // const aiHomeName = match.homeNameKor || match.home || "홈팀";
  // const aiAwayName = match.awayNameKor || match.away || "원정팀";

  const datePartsForText = dateShort.split('/');
  const displayDate = `${parseInt(datePartsForText[1], 10)}월 ${parseInt(datePartsForText[2], 10)}일`;

  let extractedDesc = `${aiHomeName}(${match.home}) vs ${aiAwayName}(${match.away}) ${displayDate} ${korCat}분석 스포츠분석리포트 | 무료스포츠픽 - 픽천국`;
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
if (textParts.length >= 2) {
    cleanedText = marker + textParts[1];
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
  // 🔥 markdown 불필요 기호 정리
  // 단독 ### 라인 제거
  cleanedText = cleanedText.replace(/^#{1,6}\s*$/gm, "");
  // *** 단독 라인 제거
  cleanedText = cleanedText.replace(/^\*{3,}$/gm, "");
  // --- 단독 라인 제거
  cleanedText = cleanedText.replace(/^-{3,}$/gm, "");
  // **텍스트** → 텍스트
  cleanedText = cleanedText.replace(/\*\*(.*?)\*\*/g, "$1");
  // __텍스트__ → 텍스트
  cleanedText = cleanedText.replace(/__(.*?)__/g, "$1");
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
  { target: /^(Premier Soccer League|PRO LEAGUE|Football Premier League|Premier League)$/i, replace: "P.L" },
  { target: /^Challengers League$/i, replace: "CL" },
  { target: /^LCK CHALLENGERS LEAGUE$/i, replace: "LCK CL" },
  { target: /^Friendly International$/i, replace: "국제친선" },
  { target: /^Super League$/i, replace: "SL" },
  { target: /^Major League Soccer$/i, replace: "MLS" },
  { target: /^African Club Championship$/i, replace: "CAF" },
  { target: /^K League 1$/i, replace: "K1" },
  { target: /^K League 2$/i, replace: "K2" },
  { target: /^UEFA Champions League$/i, replace: "UEFA 챔피언스리그" },
  { target: /^UEFA Europa League$/i, replace: "UEFA 유로파리그" },
  { target: /^AFC ASIAN CUP$/i, replace: "AFC 아시안컵" },
  { target: /^LCK CHALLENGERS LEAGUE ROUNDS 1-2$/i, replace: "LCK CL" },    
  { target: /^LCK ROUNDS 1-2$/i, replace: "LCK" },
  { target: /^Veikkausliiga$/i, replace: "D1" },
  { target: /^JUPILER PRO LEAGUE$/i, replace: "D1" },
  { target: /^Eliteserien$/i, replace: "D1" },
  { target: /^Premier Division$/i, replace: "D1" },
  { target: /^Division 1$/i, replace: "D1" },
  { target: /^2. Bundesliga$/i, replace: "분데스리가2" },
  { target: /^Beijer Hockey Games$/i, replace: "유로 하키 투어" },
  { target: /^B League$/i, replace: "B리그" },
  { target: /^Serie A$/i, replace: "세리에 A" },
  { target: /^Bundesliga$/i, replace: "분데스리가" },
  { target: /^Primeira Liga$/i, replace: "프리메라리가" },
  { target: /^Esports World Cup Playoffs$/i, replace: "EWC 플레이오프 " },
  { target: /^Primera División - Apertura$/i, replace: "프리메라디비전" },
  { target: /^LA LIGA$/i, replace: "라리가" },
  { target: /^UEFA Europa Conference League$/i, replace: "UEFA 컨퍼런스리그" },
  { target: /^CONMEBOL Sudamericana$/i, replace: "코파 수다메리카나" },
  { target: /^IL$/i, replace: "트리플A-IL" },
  { target: /^CONMEBOL Libertadores$/i, replace: "코파 리베르타도레스" },
  { target: /^NBA W$/i, replace: "WNBA" },
  { target: /^Nations League Women$/i, replace: "네이션스리그(W)" },
  { target: /^Nations League$/i, replace: "네이션스리그" },
  { target: /^European League Women$/i, replace: "유러피언리그(W)" },
  { target: /^European League$/i, replace: "유러피언리그" }
        
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
    "FRIENDLY INTERNATIONAL": "국제",
    "INTERNATIONAL FRIENDLY": "국제",
    "CPBL": "대만",
    "KBO": "대한민국",
    "CONCACAF CHAMPIONS LEAGUE": "북중미",
    "ESPORTS WORLD CUP PLAYOFFS": "국제",
    "ESPORTS WORLD CUP": "국제",
    "WORLD CHAMPIONSHIP": "국제",
    "KHL": "러시아",
    "NHL": "미국",
    "ASIA CHAMPIONS LEAGUE": "국제",
    "EUROPE": "유럽",
    "LCS": "북미",
    "CONMEBOL SUDAMERICANA": "남미",
    "IL": "미국",
    "NATIONS LEAGUE WOMEN": "국제",
    "NATIONS LEAGUE": "국제",
    "EUROPEAN LEAGUE WOMEN": "유럽",
    "EUROPEAN LEAGUE": "유럽",
  
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
| **<span style="color: #007bff;">홈팀</span>** | <img src="${match.homeLogo}" width="31" height="30" style="vertical-align: middle;"> **${aiHomeName} (${match.home})** |
| **<span style="color: #007bff;">원정팀</span>** | <img src="${match.awayLogo}" width="31" height="30" style="vertical-align: middle;"> **${aiAwayName} (${match.away})** |
| **<span style="color: #007bff;">리그</span>** | **${country}: ${leagueName}** |
| **<span style="color: #007bff;">경기시간</span>** | **${new Date(match.date).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })}** |`;

  // 7. 기존 AI 요약 전체 삭제 (모든 변형 패턴 제거)
cleanedText = cleanedText
  .replace(/###\s*🏟️\s*경기 정보 요약[\s\S]*?(?=###|$)/g, "")
  .replace(/🏟️\s*경기 정보 요약[\s\S]*?(?=###|⚔️|📝|🎯)/g, "")
  .replace(/날짜:\s*.*\n[\s\S]*?(?=\n\n[가-힣]|\n###)/g, "")
  .trim();

 // 8. 맨 위에 강제 삽입
cleanedText = summaryTable + "\n\n" + cleanedText;

// ✅ [추가] summaryTable 삽입 후, 경기정보요약 표와 첫 번째 홈팀 분석(###) 사이의 불필요한 텍스트 제거
cleanedText = cleanedText.replace(
  /(경기시간[^\n]*\n)\n*([\s\S]*?)\n*(###\s*<img)/,
  (_, p1, p2, p3) => {
    const garbage = p2.trim();
    if (garbage) {
      console.log(`🧹 [중간 쓰레기 제거] "${garbage.substring(0, 60)}..."`);
    }
    return p1 + '\n\n' + p3;
  }
);

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
  const dateParts = dateShort.split('/');
  const seoDateTag = dateParts.length === 3 ? `${parseInt(dateParts[1], 10)}월${parseInt(dateParts[2], 10)}일` : '오늘';

  const finalTitle = `${country} [${leagueName}] ${aiHomeName} vs ${aiAwayName} ${displayDate} ${korCat}경기분석 | 무료스포츠픽 - 픽천국`;
    // 본문 내부에 AI가 임의로 작성한 제목 행(26/05/01... 분석)이 중복 노출되지 않도록 제거
  cleanedText = cleanedText.replace(new RegExp(`${dateShort}.*?분석`, 'g'), '').trim();

  const footer = `\n<div align="center">\n<p><b>© 픽천국(Pick Heaven)</b></p>\n<p>- 참고용으로 제공되는 스포츠분석이며, 결과에 책임지지 않습니다 -</p>\n<hr>\n#${aiHomeName.replace(/\s+/g, '')}(${match.home}) #${aiAwayName.replace(/\s+/g, '')}(${match.away}) #${seoDateTag} #무료스포츠픽 #스포츠경기분석\n</div>`;

 // 팀명을 포함하여 고유성을 보장 (safeHomeName 활용)
const safeHomeNameForSlug = getSafeLogoName(match.home); 

// ✅ [검증 4] 필수 섹션 완전성 검사 - 저장 직전 최종 관문
const requiredSections = ['분석', '⚔️', '📝', '🎯'];
const missingSections = requiredSections.filter(s => !cleanedText.includes(s));
if (missingSections.length > 0) {
  console.error(`❌ [구조 불완전] 누락 섹션 감지 (${missingSections.join(', ')}): ${match.home} vs ${match.away}`);
  return false; // 
}

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
homeLogo: "${match.homeLogo}"
awayLogo: "${match.awayLogo}"
---

${cleanedText}${footer}`;

  fs.writeFileSync(savePath, content, 'utf8');
  console.log(`✅ [저장성공] ${finalTitle}`);
  return true;
}

analyzeMatches();
