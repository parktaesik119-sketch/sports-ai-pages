// scripts/match-filter.js
// analyze-router-one-git.js가 "오늘 수집된 경기 중 실제로 분석글을 쓸 경기"를 고르는
// 리그/국가/팀 화이트리스트·블랙리스트 로직을 그대로 뽑아낸 공용 모듈.
//
// ⚠️ 이 파일은 analyze-router-one-git.js의 filteredMatches 필터 로직을 1:1로 옮긴 것이다.
// fetch-footystats-context.js(그리고 앞으로 비슷한 sport-context 수집기를 새로 만들 때)는
// 반드시 이 함수로 먼저 걸러낸 경기만 대상으로 삼아야 한다 — 그래야 "오늘 전 세계 축구
// 경기 전체"가 아니라 "실제로 분석글이 나갈 경기"만 footystats에 요청하게 된다.
//
// 리그를 추가/제외하고 싶으면 이 파일 하나만 고치면 analyze-router-one-git.js와
// fetch-footystats-context.js(및 앞으로 이 함수를 쓰는 모든 곳)에 동시에 반영된다.
// (analyze-router-one-git.js 쪽도 이 함수를 import해서 쓰도록 바꿔서, 로직이 두 곳에
// 따로 존재하며 서서히 어긋나는 걸 막았다)

// 국가명 표기가 데이터 소스마다 다를 수 있어(하이픈/공백 유무, "Republic" 포함 여부 등)
// 정규화(소문자 + 공백·하이픈 제거) 후 알려진 한국 표기들과 비교합니다.
// FA Cup처럼 "한국만 통과"시켜야 하는 조건에 사용됩니다.
function normalizeCountry(c) {
  return (c || '').toLowerCase().replace(/[\s-]+/g, '');
}
const KOREA_COUNTRY_ALIASES = new Set([
  'southkorea',        // South-Korea, South Korea
  'korearepublic',     // Korea Republic, Korea-Republic
  'korea,republicof',  // Korea, Republic of
  'republicofkorea',   // Republic of Korea
  'korearep',          // Korea Rep
  'kor',               // 코드로 오는 경우
]);
function isKoreaCountry(c) {
  return KOREA_COUNTRY_ALIASES.has(normalizeCountry(c));
}

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
  '1. DIVISION', 'FEDERACION', 'SUPER LEAGUE 2', '2. Deild', '3. Division', '3. Division - Girone 6', 'Ykkösliiga', 'Kakkonen - Lohko C', 'Kakkonen - Lohko A', 'Kakkonen - Lohko B', 'Kakkonen', 'Superettan', 'Ettan - Södra', 'Ettan - Norra', 'Ettan', 'Division 2 - Norra Götaland', 'Division 2 - Östra Götaland', 'Götaland', 'Division 2 - Västra Götaland', 'Damallsvenskan', 'Division 2 - Norrland', 'First Division',
  'U18 PREMIER LEAGUE', 'PREMIER LEAGUE INTERNATIONAL CUP', 'Elitettan', 'Damallsvenskan', 'Ettan', 'Svealand', 'Prime League', 'North American', 'NWSL', 'Central', 'MLS Next Pro',
    // 농구 및 기타 (Basketball & Others)
  'ABA LEAGUE', 'USL CHAMPIONSHIP', 'BAHRAIN', 'Balkan', 'HLL', 'LES', 'Circuito', 'LRS', 'Legends',  'ACB', 'NBL', 'USHL', 'SHL', 'Liiga', 'DEL', 'SuperLega', 'PlusLiga', 'LFL', 'Prime League', 'Arabian League', 'TCL', 'Regular', 'LIT', 'BSN', 'LNB', 'LBP', 'PCL', 'SPHL', 'ECHL', 'Regular Season', 'LPLOL Regular Season', 'LPLOL REGULAR SEASON','Esports World Cup Playoffs','ESPORTS WORLD CUP PLAYOFFS','ESPORTS WORLD CUP', 'Esports World Cup',
];

  // ⬇️ 제외하고 싶은 국가명을 정확히 입력하세요 //대소문자 구분없음
    const blockedCountries = [
  "Bahrain", "Kyrgyzstan", "Uzbekistan", "Uganda", "Eswatini", "Zambia", "India", "South-Africa", "Malaysia", "Malta", "Kenya", "Barbados", "Peru", "Bolivia", "Honduras", "Cambodia", "Ivory-Coast", "Cyprus", "Burkina-Faso", "Azerbaijan", "Belarus", "Kazakhstan", "Ukraine", "Zimbabwe", "Rwanda", "Congo", "Mongolia", "Armenia", "Indonesia", "Syria", "Ethiopia", "Chile", "Ecuador", "Lithuania", "Mauritania", "Latvia", "Estonia", "Balkans", "Puerto Rico", "Dominican Republic", "Aruba", "Philippines", 'PERU', 'ECUADOR', 'AZERBAIJAN', 'ARMENIA', 'BELARUS', 'KAZAKHSTAN', 'UKRAINE', 'ICELAND', 'LITHUANIA', 'LATVIA', 'ESTONIA', 'MALTA', 'CYPRUS', 'SYRIA', 'BARBADOS', 'Bangladesh', 'Tunisia', 'Malawi', 'Ghana', 'Lebanon', 'Botswana',
  "Slovakia", "Faroe-Islands", 'Libya','Aruba', 'Panama', 'Bhutan', 'Ethiopia', 'Congo-DR', 'Israel', "El Salvador", 'El-Salvador', 'Jamaica', 'Rwanda', 'Mauritania', 'Zimbabwe','Ethiopia', 'Kenya', 'INDIA', 'UZBEKISTAN', 'KYRGYZSTAN', 'Bangladesh', 'Lesotho', 'Kuwait',
].filter(c => c !== "South-Korea");

    const blockedTeams = [
  // [나이,성별]
  'U21', 'U19', 'U18', 'U17', 'YOUTH', 'RESERVE', 'WOMEN', 'WOMAN', 'FEMALE', 'FRAUEN', 'FEMININE', 'FEMININE DIVISION 1', 'FEMENIL', 'BUBLIKI', 'ZEROZONE GAMING', 'RONALDO TEAM', 'THE OTTER SIDE', 'CRUSADERS', 'DREAM ESPORTS', 'GTZ ESPORTS', 'FLUXO W7M', 'PAIN GAMING', 'LOUD', 'VIVO KEYD STARS', 'RED CANIDS', 'LEVIATAN ESPORTS', 'FRITES ESPORTS CLUB', 'MCON ESPORTS', 'TBD','Central league','CENTRAL LEAGUE','Pacific league','PACIFIC LEAGUE','Nanum','NANUM','National League','American League','World'
  ];
   
  export function isMatchApproved(m) {
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
const allowedWomenLeagues = ['AFC WOMEN\'S CHAMPIONS LEAGUE','NATIONS LEAGUE WOMEN','WORLD CUP - WOMEN - QUALIFICATION EUROPE'];
const isAllowedWomenLeague = allowedWomenLeagues.some(el => el === upperLg);

  // [단계 1] 가장 먼저 여성/청소년 경기인지 확인 (최우선순위) - 있으면 무조건 차단
  const isRestricted = !isEssentialTeam && !isAllowedWomenLeague && (upperLg.includes('WOMEN') || upperLg.includes('FRAUEN') || upperLg.includes('YOUTH') || upperLg.includes('RESERVE') || upperLg.includes('U15') || upperLg.includes('U16') || upperLg.includes('U17') || upperLg.includes('U18') || upperLg.includes('U19') || upperLg.includes('U20') || upperLg.includes('U21') || upperLg.includes('U23'));

  // [단계 2] 제한 대상이면 아래 조건은 보지도 말고 즉시 종료
  if (isRestricted) {
    console.log(`🚫 [제한 대상] 여성/청소년 경기 스킵: ${m.league}`);
    return false;
  }

  // [단계 1.5] 특정 리그에서 추가 키워드 차단 (프리패스 우선 적용 전)
const leaguesWithExtraFilter = ['FRIENDLIES', 'FRIENDLY INTERNATIONAL', 'INTERNATIONAL'];

const isExtraFiltered = leaguesWithExtraFilter.some(el => el === upperLg) && (
  upperHome.includes('U17') || upperAway.includes('U17') ||
  upperHome.includes('U18') || upperAway.includes('U18') ||
  upperHome.includes('U19') || upperAway.includes('U19') ||
  upperHome.includes('U20') || upperAway.includes('U20') ||
  upperHome.includes('U21') || upperAway.includes('U21') ||
  upperHome.includes('U23') || upperAway.includes('U23') ||
  upperHome.includes('YOUTH') || upperAway.includes('YOUTH') ||
  upperHome.includes('WOMEN') || upperAway.includes('WOMEN') ||
  upperHome.includes('RESERVE') || upperAway.includes('RESERVE')
);

if (isExtraFiltered) {
  console.log(`🚫 [친선경기 추가 차단] ${m.league} - ${m.home} vs ${m.away}`);
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
    "China": ["LEAGUE ONE"],
    "Belgium": ["PRO LEAGUE"],
    "Libya": ["PREMIER LEAGUE"],
    "Russia": ["PREMIER LEAGUE"],
    "Romania": ["LIGA I"],
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
  const isMainInternational = ['FRIENDLY INTERNATIONAL', 'WORLD CUP', 'EURO', 'COPA AMERICA', 'AFC ASIAN CUP', 'OLYMPIC', 'UEFA','CONCACAF CHAMPIONS LEAGUE', 'OFC PRO LEAGUE'].some(el => upperLg.includes(el));
    // 1부 리그 명칭들 (완전 일치로 변경하여 잡리그 방어)
  // ⚠️ 'FA CUP'은 여기서 제외했습니다 — FA Cup은 국가 상관없이 전부 통과되면 안 되고
  // 한국 FA컵만 통과시켜야 해서, 아래 isKoreaFACup으로 별도 처리합니다.
  const isFirstDivision = ['DIVISION 1', '1 DIVISION', 'PREMIER DIVISION', 'PREMIERSHIP', 'SUPER LEAGUE', 'PRO LEAGUE', 'PREMIER', 'A LEAGUE', 'JUPILER PRO LEAGUE', 'AFRICAN CLUB CHAMPIONSHIP', 'PFL', 'AFC U17 ASIAN CUP', 'J1 LEAGUE', 'J2/J3 LEAGUE', 'PRIMERA DIVISIÓN - APERTURA', "AFC WOMEN'S CHAMPIONS LEAGUE",'LEAGUE ONE', 'V.LEAGUE 1', 'TAIWAN FOOTBALL PREMIER LEAGUE','DFB POKAL', 'COPA LIBERTADORES','WK-LEAGUE','PRIMERA A','WORLD CUP - WOMEN - QUALIFICATION EUROPE','ASEAN CHAMPIONSHIP', 'LIGA I'].some(el => el === upperLg);

  // FA Cup은 한국(대한FA컵)만 통과, 다른 나라 FA Cup은 차단
  // country 표기가 소스마다 다를 수 있어(South-Korea / South Korea / Korea Republic 등)
  // isKoreaCountry()로 정규화 비교합니다.
  const isKoreaFACup = upperLg === 'FA CUP' && isKoreaCountry(country);

  // 축구 통합 필터
  const soccerFilter = (sport === 'soccer') && !isRestricted && (top5 || korea || mls || isMainInternational || isFirstDivision || isKoreaFACup);

  // 2. 농구 
  const basketball = ['KBL', 'WKBL', 'CBA', 'B.LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'B LEAGUE', 'NBA', 'ASIA CHAMPIONS LEAGUE', 'EUROLEAGUE','NBA W', 'NBA SALT LAKE CITY SUMMER LEAGUE', 'CALIFORNIA CLASSIC', 'NBA - LAS VEGAS SUMMER LEAGUE'].some(el => el === upperLg);
  // 3. 배구 
  const volleyball = ['V-LEAGUE', 'KOVO', 'KOREA V', 'V.LEAGUE', 'SUPER LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'FRIENDLY INTERNATIONAL', 'NATIONS LEAGUE WOMEN','NATIONS LEAGUE'].some(el => el === upperLg);
  // 4. 야구 
  const baseball = ['KBO', 'MLB', 'NPB', 'CPBL', 'WORLD', 'WORLDS', 'INTERNATIONAL'].some(el => el === upperLg);
  // 5. 하키 
  const hockey = ['NHL', 'KHL','WORLD CHAMPIONSHIP','FRIENDLY INTERNATIONAL', 'WCH IA','WCH IB' ].some(el => el === upperLg);
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
  const lol = ['LCK','LCK CL','LPL', 'MSI','WORLD','WORLDS','INTERNATIONAL','LCKROADTOMSI','LCKCHALLENGERSLEAGUE','KESPACUP'].includes(normalizedLg);

  // 리그 프리패스 조건에 '팀 프리패스(isEssentialTeam)'를 추가
  const isEssentialLeague = soccerFilter || basketball || volleyball || baseball || hockey || lol || isEssentialTeam;

  // [STEP 1.9] 프리패스 리그에 속해도 무조건 제외할 팀
  // (올스타전 등에서 팀명 자리에 리그명/구분값이 잘못 들어오는 케이스 방어)
  const forceBlockTeams = [
    'BUBLIKI', 'ZEROZONE GAMING', 'RONALDO TEAM', 'THE OTTER SIDE', 'CRUSADERS',
    'DREAM ESPORTS', 'GTZ ESPORTS', 'FLUXO W7M', 'PAIN GAMING', 'LOUD',
    'VIVO KEYD STARS', 'RED CANIDS', 'LEVIATAN ESPORTS', 'FRITES ESPORTS CLUB',
    'MCON ESPORTS', 'TBD', 'CENTRAL LEAGUE', 'PACIFIC LEAGUE', 'NANUM',
    'NATIONAL LEAGUE', 'AMERICAN LEAGUE', 'WORLD'
  ];

  const isForceBlocked = !isEssentialTeam && forceBlockTeams.some(t => {
    const target = t.toUpperCase().trim();
    return upperHome.includes(target) || upperAway.includes(target);
  });

  if (isForceBlocked) {
    console.log(`🚫 [프리패스 예외 차단] ${m.home} vs ${m.away} 경기를 스킵합니다.`);
    return false;
  }

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
}