import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from "openai";
import TEAM_NAME_MAP from './team_name_map.js';
import COUNTRY_MAP from './country_map.js';
import { matchTeam } from './espn-common.js';

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

function convertLeagueName(rawLeague) {
  let name = rawLeague || "스포츠";
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
    { target: /^JUPILER PRO LEAGUE$/i, replace: "D1" },
    { target: /^Premier Division$/i, replace: "D1" },
    { target: /^Division 1$/i, replace: "D1" },
    { target: /^2. Bundesliga$/i, replace: "분데스리가2" },
    { target: /^Beijer Hockey Games$/i, replace: "유로 하키 투어" },
    { target: /^B League$/i, replace: "B리그" },
    { target: /^Serie A$/i, replace: "세리에 A" },
    { target: /^Bundesliga$/i, replace: "분데스리가" },
    { target: /^Primeira Liga$/i, replace: "프리메라리가" },
    { target: /^Esports World Cup Playoffs$/i, replace: "EWC 플레이오프" },
    { target: /^Primera División - Apertura$/i, replace: "프리메라디비전" },
    { target: /^LA LIGA$/i, replace: "라리가" },
    { target: /^Segunda División$/i, replace: "라리가2" },
    { target: /^UEFA Europa Conference League$/i, replace: "UEFA 컨퍼런스리그" },
    { target: /^CONMEBOL Sudamericana$/i, replace: "코파 수다메리카나" },
    { target: /^IL$/i, replace: "트리플A-IL" },
    { target: /^CONMEBOL Libertadores$/i, replace: "코파 리베르타도레스" },
    { target: /^NBA W$/i, replace: "WNBA" },
    { target: /^Nations League Women$/i, replace: "네이션스리그(W)" },
    { target: /^Nations League$/i, replace: "네이션스리그" },
    { target: /^World Cup - Women - Qualification Europe$/i, replace: "월드컵 예선(W)" },
    { target: /^World Cup - Women$/i, replace: "월드컵 (W)" },
    { target: /^Friendlies$/i, replace: "국제친선" },
    { target: /^World Cup$/i, replace: "월드컵" },
  ];
  leagueReplacements.forEach(rule => { name = name.replace(rule.target, rule.replace); });
  return name;
}

// 공통 유틸: 팀 득점 배열 추출
function getTeamScores(matches, teamName) {
  return matches.map(m => {
    const isHome = m.home === teamName;
    const score = isHome ? Number(m.homeScore) : Number(m.awayScore);
    return isNaN(score) ? null : score;
  }).filter(s => s !== null);
}

// 공통 유틸: 가중 이동 평균 (최근 경기일수록 높은 가중치)
function trimmedAvg(scores, isBball = false) {
  if (scores.length === 0) return null;
  if (scores.length === 1) return scores[0];

  // 농구 전용: 60점 미만은 데이터 오류로 판단하여 완전 제거
  const validScores = isBball ? scores.filter(v => v >= 60) : scores;
  if (validScores.length === 0) return null;
  if (validScores.length === 1) return validScores[0];

  // scores는 최신순으로 들어옴 (index 0 = 가장 최근)
  // 가중치: 최근 경기 N, 그 전 N-1, ... 1
  const n = validScores.length;
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < n; i++) {
    const weight = n - i;
    weightedSum += validScores[i] * weight;
    totalWeight += weight;
  }

  return weightedSum / totalWeight;
}

// H2H 평균 득점 계산 (홈팀/원정팀 각각 양쪽 포지션 모두 포함)
function getH2hAvgScore(h2hMatches, teamName) {
  const scores = h2hMatches.map(m => {
    const isHome = m.home === teamName;
    const score = isHome ? Number(m.homeScore) : Number(m.awayScore);
    return isNaN(score) ? null : score;
  }).filter(s => s !== null && s >= 0);  // null 제거는 동일
  if (scores.length === 0) return null;
  // 전체가 0점인 경기만 있으면 null 처리 (0-0 무승부 등)
  const nonZero = scores.filter(s => s > 0);
  if (nonZero.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// H2H 경기 수에 따라 동적으로 가중치 결정
// 1경기:20% / 2경기:35% / 3경기:45% / 4경기 이상:55%
function getH2hWeight(h2hCount) {
  if (h2hCount <= 0) return 0;
  if (h2hCount === 1) return 0.20;
  if (h2hCount === 2) return 0.35;
  if (h2hCount === 3) return 0.45;
  return 0.55; // 4경기 이상
}

// 가중 평균: H2H 경기 수에 따라 동적 가중치 적용 (H2H 없으면 최근 경기 100%)
function weightedAvg(recentAvg, h2hAvg, h2hCount = 0) {
  if (recentAvg === null) return null;
  if (h2hAvg === null || h2hCount === 0) return recentAvg;
  const h2hWeight = getH2hWeight(h2hCount);
  return recentAvg * (1 - h2hWeight) + h2hAvg * h2hWeight;
}

// 예상 스코어 계산 함수 (홈팀/원정팀 각각 반환)
function calcExpectedScores(homeMatches, awayMatches, homeTeam, awayTeam, cat, h2hMatches = []) {
  const isBball = cat === 'basketball';

  const homeRecentAvg = trimmedAvg(getTeamScores(homeMatches, homeTeam), isBball);
  const awayRecentAvg = trimmedAvg(getTeamScores(awayMatches, awayTeam), isBball);

  const homeH2hAvg = getH2hAvgScore(h2hMatches, homeTeam);
  const awayH2hAvg = getH2hAvgScore(h2hMatches, awayTeam);
  const h2hCount   = h2hMatches.length;

  const homeAvg = weightedAvg(homeRecentAvg, homeH2hAvg, h2hCount);
  const awayAvg = weightedAvg(awayRecentAvg, awayH2hAvg, h2hCount);

  if (homeAvg === null || awayAvg === null) return null;

  // 종목별 반올림 및 동점 보정
  const roundScore = (val) => Math.round(val);

  let homeScore = roundScore(homeAvg);
  let awayScore = roundScore(awayAvg);

  // 축구 전용: avg 차이 기반 스코어 보정
  if (cat === 'soccer') {
    const avgDiff = Math.abs(homeAvg - awayAvg);

    // avg 차이 > 0.15인데 반올림 결과가 동점이면 → avg 낮은 팀 -1 (최소 0)
    if (avgDiff > 0.15 && homeScore === awayScore) {
      if (homeAvg < awayAvg) {
        homeScore = Math.max(0, homeScore - 1);
      } else {
        awayScore = Math.max(0, awayScore - 1);
      }
    }
    // avg 차이 ≤ 0.15이면 → 무승부 (스코어는 반올림 그대로 유지)
  }

  // 동점 보정(축구 제외)은 savePost에서 픽 승자 확정 후 처리하므로 여기선 제거
  // calcExpectedScores는 순수 계산값만 반환

  // 배구: 세트 스코어로 변환 (3:0 / 3:1 / 3:2)
  if (cat === 'volleyball') {
    const ratio = homeAvg / (homeAvg + awayAvg);
    let homeScore, awayScore;
    if (ratio >= 0.75)      { homeScore = 3; awayScore = 0; }
    else if (ratio >= 0.58) { homeScore = 3; awayScore = 1; }
    else if (ratio >= 0.5)  { homeScore = 3; awayScore = 2; }
    else if (ratio >= 0.42) { homeScore = 2; awayScore = 3; }
    else if (ratio >= 0.25) { homeScore = 1; awayScore = 3; }
    else                    { homeScore = 0; awayScore = 3; }
    return { homeScore, awayScore, homeAvg: parseFloat(homeAvg.toFixed(2)), awayAvg: parseFloat(awayAvg.toFixed(2)) };
  }

  return { homeScore, awayScore, homeAvg: parseFloat(homeAvg.toFixed(2)), awayAvg: parseFloat(awayAvg.toFixed(2)) };
}

// 핸디캡 제약 계산용 합산 총점 (기존 calcOuValue 역할 유지)
function calcOuValue(homeMatches, awayMatches, homeTeam, awayTeam, cat, h2hMatches = []) {
  const result = calcExpectedScores(homeMatches, awayMatches, homeTeam, awayTeam, cat, h2hMatches);
  if (!result) return null;
  const raw = result.homeScore + result.awayScore;
  if (cat === 'basketball') {
    return Math.min(215.5, Math.max(155.5, raw)).toFixed(1);
  } else if (cat === 'baseball') {
    return Math.min(15.5, Math.max(4.5, raw)).toFixed(1);
  } else {
    return String(raw);
  }
}

// 예상스코어 기반 핸디캡 자동 산출 함수
// expectedScores: { homeScore, awayScore } 또는 null
// winnerIsHome: true = 홈팀 승 예상, false = 원정팀 승 예상
function calcHandicapValue(cat, expectedScores, winnerIsHome) {
  if (!expectedScores) return null;

  const diff = Math.abs(expectedScores.homeScore - expectedScores.awayScore);
  const sign = winnerIsHome ? '-' : '+';

  if (cat === 'soccer' || cat === 'hockey') {
    if (diff <= 1) return `${sign}0.5`;
    if (diff === 2) return `${sign}1.5`;
    return `${sign}2.5`;
  }

  if (cat === 'baseball') {
    if (diff <= 1) return `${sign}0.5`;
    if (diff <= 3) return `${sign}1.5`;
    return `${sign}2.5`;
  }

  if (cat === 'basketball') {
    if (diff <= 4)  return `${sign}2.5`;
    if (diff <= 9)  return `${sign}5.5`;
    if (diff <= 14) return `${sign}8.5`;
    if (diff <= 19) return `${sign}11.5`;
    return `${sign}15.5`;
  }

  if (cat === 'volleyball') {
    // 세트스코어 기반: expectedScores = { homeScore: 세트, awayScore: 세트 }
    if (diff === 3) return `${sign}2.5`;
    if (diff === 2) return `${sign}1.5`;
    return `${sign}0.5`;
  }

  return null;
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
  const matchLines = lines.map(l => `${l}<br>`).join('\n');
  return `${summary}\n\n📋 최근 경기<br>\n${matchLines}\n\n`;
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

    // ESPN 결장자/순위 컨텍스트 로드 (fetch-espn-context.js가 미리 생성)
    const espnContextPath = path.resolve(__dirname, `../database/espn-context-${today}.json`);
    const espnContextList = fs.existsSync(espnContextPath)
      ? JSON.parse(fs.readFileSync(espnContextPath, 'utf8'))
      : [];
    if (espnContextList.length > 0) {
      console.log(`📊 [ESPN 컨텍스트] ${espnContextList.length}건 로드됨`);
    }

    // KBO 컨텍스트 로드 (fetch-kbo-context.js가 미리 생성) — ESPN이 커버 못하는 KBO 전용
    // fetch-kbo-context.js가 match.home/away를 원문 그대로 저장하므로 정확 일치로 매칭 가능
    const kboContextPath = path.resolve(__dirname, `../database/kbo-context-${today}.json`);
    const kboContextList = fs.existsSync(kboContextPath)
      ? JSON.parse(fs.readFileSync(kboContextPath, 'utf8'))
      : [];
    if (kboContextList.length > 0) {
      console.log(`⚾ [KBO 컨텍스트] ${kboContextList.length}건 로드됨`);
    }

    function findKboContext(match) {
      return kboContextList.find(k => k.home === match.home && k.away === match.away) || null;
    }

    // NPB 컨텍스트 로드 (fetch-npb-context.js가 미리 생성) — 선발투수만 제공 (NPB는 라인업 사전공개가 없음)
    const npbContextPath = path.resolve(__dirname, `../database/npb-context-${today}.json`);
    const npbContextList = fs.existsSync(npbContextPath)
      ? JSON.parse(fs.readFileSync(npbContextPath, 'utf8'))
      : [];
    if (npbContextList.length > 0) {
      console.log(`⚾ [NPB 컨텍스트] ${npbContextList.length}건 로드됨`);
    }

    function findNpbContext(match) {
      return npbContextList.find(n => n.home === match.home && n.away === match.away) || null;
    }

    function findEspnContext(match) {
      const candidates = espnContextList.filter(e =>
        (matchTeam(e.home, match.home) && matchTeam(e.away, match.away)) ||
        (matchTeam(e.home, match.away) && matchTeam(e.away, match.home))
      );
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      // 같은 팀조합이 시리즈로 여러 번 겹치는 경우(MLB 3연전 등) 날짜가 가장 가까운 항목을 선택
      const targetTime = new Date(match.date).getTime();
      return candidates.reduce((best, cur) => {
        const curTime = new Date(cur.date).getTime();
        const bestTime = new Date(best.date).getTime();
        if (Number.isNaN(curTime)) return best;
        if (Number.isNaN(bestTime)) return cur;
        return Math.abs(curTime - targetTime) < Math.abs(bestTime - targetTime) ? cur : best;
      });
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
  '1. DIVISION', 'FEDERACION', 'SUPER LEAGUE 2', '2. Deild', '3. Division', '3. Division - Girone 6', 'UEFA Europa Conference League', 'Ykkösliiga', 'Kakkonen - Lohko C', 'Kakkonen - Lohko A', 'Kakkonen - Lohko B', 'Kakkonen', 'Superettan', 'Ettan - Södra', 'Ettan - Norra', 'Ettan', 'Division 2 - Norra Götaland', 'Division 2 - Östra Götaland', 'Götaland', 'Division 2 - Västra Götaland', 'Damallsvenskan', 'Division 2 - Norrland', 'First Division',
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
  const isFirstDivision = ['DIVISION 1', '1 DIVISION', 'PREMIER DIVISION', 'PREMIERSHIP', 'SUPER LEAGUE', 'PRO LEAGUE', 'PREMIER', 'A LEAGUE', 'JUPILER PRO LEAGUE', 'AFRICAN CLUB CHAMPIONSHIP', 'PFL', 'AFC U17 ASIAN CUP', 'J1 LEAGUE', 'J2/J3 LEAGUE', 'PRIMERA DIVISIÓN - APERTURA', "AFC WOMEN'S CHAMPIONS LEAGUE",'LEAGUE ONE', 'V.LEAGUE 1', 'LIGA I', 'TAIWAN FOOTBALL PREMIER LEAGUE','DFB POKAL', 'CONMEBOL SUDAMERICANA','WK-LEAGUE','PRIMERA A','WORLD CUP - WOMEN - QUALIFICATION EUROPE','ASEAN CHAMPIONSHIP'].some(el => el === upperLg);

  // 축구 통합 필터
  const soccerFilter = (sport === 'soccer') && !isRestricted && (top5 || korea || mls || isMainInternational || isFirstDivision);

  // 2. 농구 
  const basketball = ['KBL', 'WKBL', 'CBA', 'B.LEAGUE', 'WORLD', 'WORLDS', 'INTERNATIONAL', 'B LEAGUE', 'NBA', 'ASIA CHAMPIONS LEAGUE', 'EUROLEAGUE','NBA W'].some(el => el === upperLg);
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
  const lol = ['LCK','LCK CL','LPL', 'LCS','LEC', 'MSI','WORLD','WORLDS','INTERNATIONAL','LCKROADTOMSI','LCKCHALLENGERSLEAGUE'].includes(normalizedLg);

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


    console.log(`🚀 [픽천국 엔진] ${today} 총 ${filteredMatches.length}개 분석 시작 (GPT 5.4 mini)`);

    const retryQueue = []; // ← 여기로 이동

    // 1. 절대로 변하지 않는 '절대 규칙/지시문'만 시스템 프롬프트로 고정합니다. (캐싱 대상)
  const SYSTEM_RULES_PROMPT = `
너는 '픽천국'의 수석 분석가다. 아래 규칙을 반드시 준수하라.

[출력 형식 - 절대 엄수]
반드시 아래 키=값 형식으로만 출력하라. 마크다운, HTML, ### 헤더, <br> 태그를 절대 사용하지 마라.
키 이름을 변경하거나 추가하지 마라. 설명 문장, 행동 예고, 내부 추론을 절대 포함하지 마라.
각 키(HOME_ANALYSIS, AWAY_ANALYSIS, HOME_POWER 등)는 반드시 새 줄(줄바꿈)에서 시작하라. 이전 키의 값과 다음 키 이름을 같은 줄에 이어 쓰지 마라.

HOME_ANALYSIS: (홈팀 분석. 존댓말로 자연스럽게 5문장 이상 서술하라. 반드시 [홈팀 시즌 전체 DB]만 기준으로 시즌 성적(승패수, 승률, 득점 평균 등)을 첫 문장에 언급하고, 최근 흐름과 자연스럽게 연결하라. 득점력, 수비력, 홈/원정 성적, 강점 또는 주목 선수를 흐름 안에 녹여 작성하라. 다른 연도 수치 사용 절대 금지. "최근 5경기에서 N승 N패" 같은 수치 나열식 첫 문장 절대 금지. 축구 종목을 제외하고 나머지 모든 종목은 무승부 표현 절대 금지. 문장 사이 구분은 공백으로만.)
AWAY_ANALYSIS: (원정팀 분석. HOME_ANALYSIS와 동일한 방식으로 원정팀 기준으로 작성하라. 반드시 [원정팀 시즌 전체 DB]만 기준으로 시즌 성적을 먼저 언급하고 최근 흐름과 자연스럽게 연결하라. 다른 연도 수치 사용 절대 금지. 축구 종목을 제외하고 나머지 모든 종목은 무승부 표현 절대 금지. 문장 사이 구분은 공백으로만.)
HOME_POWER: (홈팀 핵심 전력 포인트 5개를 파이프(|)로 구분. 각 35자 이내. HOME_ANALYSIS에 이미 쓴 문장이나 수치를 그대로 반복하지 마라 — 같은 데이터를 다른 각도로 해석한 통찰을 담아라. 단순히 "N승N패", "평균 N득점" 같은 시즌 기록 나열이 아니라, 그 기록이 시사하는 패턴이나 강약점을 한 줄로 압축하라. 가능하면 수치를 근거로 들되, 수치 자체보다 "그래서 어떻다"는 해석이 핵심이다. 문장은 반드시 "~함/~음/~임/~보임/~검증됨" 같은 명사형·요약체 종결어미로 끝내라. "~합니다", "~있습니다" 같은 완결된 존댓말 문장 절대 금지 — 서술이 아니라 한 줄 요약처럼 읽혀야 한다. 팀명 언급 시 반드시 한글 풀네임으로 표기하라. 영문·약식 팀명 절대 금지. 예: 최근 맞대결 5경기 중 4승, 상대 상성 확실한 우위|최근 4경기 모두 2득점 이상, 화력보단 꾸준함이 강점|원정 약한 상대 수비 vs 안정적 홈 운영, 매치업상 유리|직전 경기 무득점 포함 마무리 효율은 기복 변수|조 1위로 마친 만큼 큰 경기 운영력은 검증된 상태)
AWAY_POWER: (원정팀 핵심 전력 포인트 5개를 파이프(|)로 구분. 각 35자 이내. AWAY_ANALYSIS와 동일한 방식·동일한 원칙(수치 재탕 금지, 패턴·시사점 중심)으로 원정팀 기준으로 작성하라. 문장은 반드시 "~함/~음/~임/~보임/~검증됨" 같은 명사형·요약체 종결어미로 끝내라. "~합니다", "~있습니다" 같은 완결된 존댓말 문장 절대 금지. 팀명 언급 시 반드시 한글 풀네임으로 표기하라. 영문·약식 팀명 절대 금지.)
H2H: (상대전적. DB에 있으면 각 경기를 파이프(|)로 구분하여 기재. 형식: YYYY.MM.DD - 홈팀 (스코어) 원정팀. DB에 없으면 반드시 "※ H2H 업데이트 예정" 으로만 표기. 웹 검색 절대 금지.)
SUMMARY: (종합 분석. 존댓말로 3문장 이상. 반드시 [시즌 전체 DB] 기준 수치만 활용하라. 다른 연도 수치 사용 절대 금지. 아래 금지 사항을 반드시 준수하라. ①"제공된 DB", "DB만 놓고 보면", "H2H DB가 없어", "상대전적은 반영하지 않았고", "웹 검색 결과상", "결장 근거가 제한적" 같은 분석 과정·출처·한계를 드러내는 표현 절대 금지. ②독자 입장에서 읽히는 깔끔한 전력 비교와 예측만 작성하라. ③양 팀의 시즌 전력 차이, 득점/수비 흐름, 주목 포인트 순서로 자연스럽게 서술하라.)
INJURY_HOME: (홈팀 부상/결장 선수. 선수명은 영문 원문 그대로 유지. 사유는 한글로 번역. 형식: 선수명 (한글사유)|선수명 (한글사유). 없으면 "없음". 플레이스홀더 절대 금지)
INJURY_AWAY: (원정팀 부상/결장 선수. 선수명은 영문 원문 그대로 유지. 사유는 한글로 번역. 형식: 선수명 (한글사유)|선수명 (한글사유). 없으면 "없음". 플레이스홀더 절대 금지)
PICK_WIN_TEAM: (승리 예상 팀명. 무승부이면 "무승부". 배당 검색 금지. 반드시 아래 제공된 최근경기 DB와 상대전적 DB만을 근거로 판단하라.)
PICK_WIN_RESULT: (승 또는 무승부)
PICK_HANDICAP_TEAM: (핸디캡 기준 팀명. 반드시 PICK_WIN_TEAM과 동일한 팀으로 설정하라. 배당 검색 금지.)
PICK_HANDICAP_VALUE: (경기 정보에 제공된 핸디캡 값을 그대로 출력하라. LOL은 세트 기준으로 자체 산출. "없음" 절대 금지. 반드시 숫자로만 기재.)
PICK_EXPECTED_HOME: (홈팀 예상 득점. 경기 정보에 제공된 JS 계산값을 그대로 출력하라. LOL/배구는 "없음"으로 표기. 반드시 숫자로만 기재.)
PICK_EXPECTED_AWAY: (원정팀 예상 득점. 경기 정보에 제공된 JS 계산값을 그대로 출력하라. LOL/배구는 "없음"으로 표기. 반드시 숫자로만 기재.)

[분석 규칙]
1. 결장자와 부상자 정보는 [ESPN 공식 데이터]가 제공된 경우 그 데이터를 그대로 사용하고 web_search를 사용하지 마라. [ESPN 공식 데이터]가 제공되지 않은 경기만 web_search로 결장자와 부상자 정보를 확인하라. 리그 순위와 시즌 성적은 제공된 DB 데이터(ESPN 순위 데이터 포함)를 활용하라. 단, 득점 평균 수치는 반드시 [경기 정보]에 제공된 JS 계산값을 기준으로만 언급하라. DB에서 자체 계산한 평균 득점 수치를 분석글에 직접 기재하지 마라.
2. 대한민국을 '남한', '한국'으로 표기하지 마라. 반드시 '대한민국'으로만 표기하라.
3. 팀명은 반드시 [경기 정보]에 제공된 홈팀/원정팀 이름을 그대로 사용하라. 임의로 번역하거나 변형하지 마라. 팀명은 반드시 풀네임으로 표기하라. "GIANTS", "MARLINS", "TWINS" 같은 약식 표기 절대 금지. 예: "GIANTS" → "SAN FRANCISCO GIANTS", "MARLINS" → "MIAMI MARLINS".
4. 한자, 일어 사용 금지. 100% 한글로만 작성하라.
5. '폼' 대신 '전력'이라고 표기하라.

[톤/스타일 지시 - 매우 중요]
6. 절대 명령조, 가르치는 톤을 쓰지 마라. 친절하고 부드러운 존댓말만 사용하라.
7. 다음 표현들을 적극 사용하라: "~입니다", "~했습니다", "~보입니다", "~있습니다", "~드립니다", "~됩니다"
8. 딱딱하고 딱딱한 표현 대신 "이런 점이 돋보입니다", "특히 주목할 만합니다", "강점으로 평가됩니다" 같은 부드러운 표현을 사용하라.
9. "~하고 있다", "~되었다" 같은 딱딱한 문체 대신 "~하고 있습니다", "~되었습니다" 처럼 존댓말로 마무리하라.
10. 종합 분석(SUMMARY)은 특히 친절하고 설명적으로 작성하라.
`;

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
  // ✅ MLB/NBA/NHL 등 데이터가 풍부한 스포츠는 3년치까지 DB 검색
  const lgUpper = (match.league || '').toUpperCase();
  const isDataRichSport = ['MLB', 'NBA', 'NHL', 'KBO', 'NPB'].some(s => lgUpper.includes(s));
  const strictlyRecentDate = new Date(isDataRichSport ? '2023-01-01' : '2024-01-01');
  const currentMatchDate = new Date(match.date);

  let h2hHistory = masterData.filter(m => {
    const isMatch = ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home));
    const matchDate = new Date(m.date);
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const isPast = matchDate < currentMatchDate;
    // score 필드가 있거나, homeScore/awayScore가 숫자로 존재할 때 스코어가 있다고 판단
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") || (typeof m.homeScore === 'number' && typeof m.awayScore === 'number');
const isZeroZero = m.homeScore === 0 && m.awayScore === 0;
const isValidScore = hasScore && !(isZeroZero && m.sport !== 'soccer');
return isMatch && isRecentEnough && isPast && isValidScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

      let h2hContent = "";
  let h2hContextForAI = "";
  if (h2hHistory.length > 0) {
    const h2hRows = h2hHistory.map(h => {
      const d = new Date(h.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timezone: 'asia/seoul' }).replace(/\s/g, '').replace(/\.$/, '');
      const finalScore = (h.homeScore !== null && h.awayScore !== null) ? `${h.homeScore}-${h.awayScore}` : h.score;
      
            
      return `| ${d} ${spacer} | ${h.home} ${spacer} | ${finalScore} ${spacer} | ${h.away} ${spacer} |`;
    }).join('\n');
    h2hContent = `\n<br>\n\n### ⚔️ 상대 전적 분석 (2025년 이후)\n| <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">홈팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |\n|:---|:---|:---:|\n${h2hRows}\n`;
    
    // AI에게 전달할 데이터도 스코어 정보를 명확히 조합하여 전달
    h2hContextForAI = `\n[내부 데이터베이스 상대전적 참고]\n${h2hHistory.map(h => {
    let scoreStr = '';
    if (h.homeScore !== null && h.awayScore !== null) {
    scoreStr = `${h.homeScore}-${h.awayScore}`;
    } else if (h.score) {
    // h.score에서 숫자만 추출 (예: "3) 애리조나 (5" → "3-5")
    const scoreMatch = h.score.match(/(\d+)[^\d]*(\d+)/);
    scoreStr = scoreMatch ? `${scoreMatch[1]}-${scoreMatch[2]}` : h.score;
    }
    const dAI = new Date(h.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, '');
return `${dAI} - ${h.home} (${scoreStr}) ${h.away}`;
return `${d} - ${h.home} (${scoreStr}) ${h.away}`;
    }).join('\n')}\nAI는 위 스코어 결과를 바탕으로 양 팀의 공수 밸런스와 상성을 반드시 분석에 반영해라.`;
    } else {
      h2hContent = "\n\n(※업데이트 예정)\n\n";
      h2hContextForAI = '[내부 DB 상대전적 없음] H2H: ※ H2H 업데이트 예정 으로만 표기';
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
      lg.includes('CPBL') 
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

  // 최근 5경기 추출
  const lgUpperRecent = (match.league || '').toUpperCase();
  const isIntlMatch = lgUpperRecent.includes('WORLD CUP') || lgUpperRecent.includes('OLYMPIC') || lgUpperRecent.includes('EURO') || lgUpperRecent.includes('COPA AMERICA') || lgUpperRecent.includes('AFC ASIAN CUP') || lgUpperRecent.includes('NATIONS LEAGUE') || lgUpperRecent.includes('WORLD CHAMPIONSHIP') || lgUpperRecent.includes('WORLD BASEBALL') || lgUpperRecent.includes('WBC') || lgUpperRecent.includes('MSI') || lgUpperRecent.includes('WORLDS') || lgUpperRecent.includes('FRIENDLY INTERNATIONAL') || lgUpperRecent.includes('FRIENDLIES');

  const isIntlCountry = (c) => {
    const cu = (c || '').toUpperCase();
    return cu === 'WORLD' || cu === 'INTERNATIONAL' || cu === '국제';
  };

  const homeRecentMatches = masterData.filter(m => {
    const isHomeTeam = m.home === match.home || m.away === match.home;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                 (typeof m.homeScore === 'number' && typeof m.awayScore === 'number');
const isZeroZero = m.homeScore === 0 && m.awayScore === 0;
const isValidScore = hasScore && !(isZeroZero && m.sport !== 'soccer');
const isSameSport = m.sport === match.sport;
const scopeOk = isIntlMatch ? isIntlCountry(m.country) : true;
return isHomeTeam && isPast && isRecentEnough && isValidScore && isSameSport && scopeOk;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

  const awayRecentMatches = masterData.filter(m => {
    const isAwayTeam = m.home === match.away || m.away === match.away;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= strictlyRecentDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                 (typeof m.homeScore === 'number' && typeof m.awayScore === 'number');
const isZeroZero = m.homeScore === 0 && m.awayScore === 0;
const isValidScore = hasScore && !(isZeroZero && m.sport !== 'soccer');
const isSameSport = m.sport === match.sport;
const scopeOk = isIntlMatch ? isIntlCountry(m.country) : true;
return isAwayTeam && isPast && isRecentEnough && isValidScore && isSameSport && scopeOk;
  }).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

  // ESPN 결장자/순위/H2H 컨텍스트 매칭 (calcExpectedScores가 h2hHistory를 쓰기 전에 먼저 해야 함)
  const espnInfo = findEspnContext(match);

  // KBO 전용 컨텍스트 매칭 (선발투수분석/구종분석/라인업). ESPN이 KBO를 커버하지 않으므로 별도 처리.
  const kboInfo = cat === 'baseball' ? findKboContext(match) : null;

  // NPB 전용 컨텍스트 매칭 (예고선발투수만 제공)
  const npbInfo = cat === 'baseball' ? findNpbContext(match) : null;

  // ESPN H2H가 있으면 기존 all-fixtures 기반 h2hContextForAI/h2hContent/h2hHistory를 덮어쓴다.
  // (all-fixtures는 2026년 4월부터 수집 중이라 시즌 초반/월드컵 등은 데이터가 부족함 — ESPN을 우선시)
  // 두 소스(all-fixtures, ESPN) 모두 {date, home, away, homeScore, awayScore} 동일 구조라
  // 같은 buildH2hRows 함수로 표를 만들어 화면 표기 방식을 통일한다.
  function buildH2hRows(games) {
    return games.map(h => {
      const d = new Date(h.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, '');
      const finalScore = (h.homeScore !== null && h.homeScore !== undefined && h.awayScore !== null && h.awayScore !== undefined)
        ? `${h.homeScore}-${h.awayScore}` : (h.score || '');
      return `| ${d} ${spacer} | ${h.home} ${spacer} | ${finalScore} ${spacer} | ${h.away} ${spacer} |`;
    }).join('\n');
  }

  if (espnInfo?.h2h?.games?.length > 0) {
    // 최신순(내림차순) 정렬 — recent 위젯과 표기 순서를 통일
    const sortedH2hGames = [...espnInfo.h2h.games].sort((a, b) => new Date(b.date) - new Date(a.date));

    const espnRows = buildH2hRows(sortedH2hGames);
    h2hContent = `\n<br>\n\n### ⚔️ 상대 전적 분석 (ESPN 공식 데이터)\n| <span style="color: #007bff;">날짜</span> ${spacer} | <span style="color: #007bff;">홈팀</span> ${spacer} | <span style="color: #007bff;">경기결과</span> ${spacer} |\n|:---|:---|:---:|\n${espnRows}\n`;

    const aiGameLines = sortedH2hGames.map(g => {
      const d = new Date(g.date).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, '');
      return `${d} - ${g.home} (${g.homeScore}-${g.awayScore}) ${g.away}`;
    }).join('\n');
    const seasonNote = espnInfo.h2h.source === 'seasonseries' && espnInfo.h2h.text ? `\n현재 시즌 상대전적 요약: ${espnInfo.h2h.text}` : '';
    h2hContextForAI = `\n[ESPN 공식 데이터 - 상대전적 ${espnInfo.h2h.totalGames}경기]\n${aiGameLines}${seasonNote}\nAI는 위 스코어 결과를 바탕으로 양 팀의 공수 밸런스와 상성을 반드시 분석에 반영해라.`;

    // h2hHistory 자체도 ESPN 데이터로 덮어써야 calcExpectedScores 계산과 프론트매터 h2h 필드(h2hItems) 둘 다
    // 동일한 ESPN 데이터를 쓰게 된다. 구조가 {date, home, away, homeScore, awayScore}로 동일해서 그대로 대입 가능.
    h2hHistory = sortedH2hGames;
  }

  // 시즌 전체 경기 추출 (올해 1월 1일 이후)
  const currentYear = new Date().getFullYear();
  const seasonStartDate = new Date(`${currentYear}-01-01`);
  const homeAllMatches = masterData.filter(m => {
    const isHomeTeam = m.home === match.home || m.away === match.home;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= seasonStartDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                     (typeof m.homeScore === 'number' && typeof m.awayScore === 'number');
    return isHomeTeam && isPast && isRecentEnough && hasScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const awayAllMatches = masterData.filter(m => {
    const isAwayTeam = m.home === match.away || m.away === match.away;
    const matchDate = new Date(m.date);
    const isPast = matchDate < currentMatchDate;
    const isRecentEnough = matchDate >= seasonStartDate;
    const hasScore = (m.score && m.score.trim() !== "" && m.score !== "-") ||
                     (typeof m.homeScore === 'number' && typeof m.awayScore === 'number');
    return isAwayTeam && isPast && isRecentEnough && hasScore;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const homeAllContext = buildRecentForm(homeAllMatches, match.home);
  const awayAllContext = buildRecentForm(awayAllMatches, match.away);

  // ✅ 최근 경기 컨텍스트 문자열 생성
  const homeRecentContext = buildRecentForm(homeRecentMatches, match.home);
  const awayRecentContext = buildRecentForm(awayRecentMatches, match.away);

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

const lgUpper2 = (match.league || '').toUpperCase();
const isInternationalTournament = lgUpper2.includes('WORLD CUP') || lgUpper2.includes('OLYMPIC') || lgUpper2.includes('EURO') || lgUpper2.includes('COPA AMERICA') || lgUpper2.includes('AFC ASIAN CUP') || lgUpper2.includes('NATIONS LEAGUE') || lgUpper2.includes('WORLD CHAMPIONSHIP') || lgUpper2.includes('WORLD BASEBALL') || lgUpper2.includes('WBC') || lgUpper2.includes('MSI') || lgUpper2.includes('WORLDS');
const leagueNameForPrompt = convertLeagueName(match.league);
const seasonLabel = isInternationalTournament ? `이번 ${leagueNameForPrompt}에서` : `${currentYear}시즌`;



// 2. 매 경기 실시간으로 변경되는 데이터만 User 프롬프트로 묶어줍니다.
const sportPickRule = cat === 'lol'
  ? `핸디캡과 오버언더 수치는 반드시 세트(set) 기준. 수치 뒤에 '세트'를 붙여라. (예: -1.5 세트, 2.5 세트)`
  : `핸디캡과 오버언더 수치 뒤에 '세트'를 절대 붙이지 마라.`;

// JS로 예상스코어 계산 (롤 제외)
const expectedScores = (cat !== 'lol')
  ? calcExpectedScores(homeRecentMatches, awayRecentMatches, match.home, match.away, cat, h2hHistory)
  : null;

  //Avg 콘솔 출력
  if (expectedScores) {
  const avgInfo = (expectedScores.homeAvg !== undefined)
  ? `homeAvg: ${expectedScores.homeAvg} / awayAvg: ${expectedScores.awayAvg}`
  : `(배구: avg 미산출)`;
console.log(`📊 [Avg] ${match.home} vs ${match.away} | ${avgInfo} | homeScore: ${expectedScores.homeScore} / awayScore: ${expectedScores.awayScore}`);
}

// JS로 OU 합산 계산 (핸디캡 제약용, 롤/배구 제외)
const computedOuValue = (cat !== 'lol' && cat !== 'volleyball')
  ? calcOuValue(homeRecentMatches, awayRecentMatches, match.home, match.away, cat, h2hHistory)
  : null;

// 예상스코어 동점 여부 (축구만 동점 허용)
const isDrawExpected = expectedScores !== null
  && expectedScores.homeScore === expectedScores.awayScore
  && cat === 'soccer';

// jsHandicapValue는 savePost에서 동점 보정 후 finalExpectedHome/Away 기준으로 산출
const jsHandicapValue = null;

const ouInstruction = expectedScores !== null
  ? (() => {
      const homeAvg = expectedScores.homeAvg;
      const awayAvg = expectedScores.awayAvg;
      const scoreRevealInPrompt = (cat === 'soccer' || cat === 'volleyball' || cat === 'hockey');
const drawNote = (cat === 'soccer' && Math.abs((expectedScores.homeAvg ?? 0) - (expectedScores.awayAvg ?? 0)) <= 0.15)
  ? ` avg 차이가 0.15 이하이므로 예상 결과는 무승부다. SUMMARY는 반드시 이 스코어(${expectedScores.homeScore}:${expectedScores.awayScore} 무승부)를 기준으로 종합 분석을 서술하라.`
  : ` SUMMARY는 반드시 이 예상 스코어(홈팀 ${expectedScores.homeScore} - 원정팀 ${expectedScores.awayScore})를 기준으로 종합 분석을 서술하라.`;
let base = scoreRevealInPrompt
  ? `예상 스코어는 JS 계산 결과 홈팀 ${expectedScores.homeScore} - 원정팀 ${expectedScores.awayScore} 이다. PICK_EXPECTED_HOME은 반드시 ${expectedScores.homeScore} 로, PICK_EXPECTED_AWAY는 반드시 ${expectedScores.awayScore} 로 출력하라.${drawNote}`
  : `PICK_EXPECTED_HOME은 반드시 ${expectedScores.homeScore} 로, PICK_EXPECTED_AWAY는 반드시 ${expectedScores.awayScore} 로 출력하라. 예상 스코어 수치는 분석 본문에 절대 언급하지 마라.${drawNote}`;
      if (homeAvg !== null && awayAvg !== null && homeAvg !== awayAvg) {
        const stronger = homeAvg > awayAvg ? '홈팀' : '원정팀';
        const _aiHome = TEAM_NAME_MAP[match.home] || match.home;
const _aiAway = TEAM_NAME_MAP[match.away] || match.away;
base += ` 전력 분석상 ${stronger}이 우위에 있으므로 PICK_WIN_TEAM은 ${stronger === '홈팀' ? _aiHome : _aiAway}으로 출력하라.`;
      }
      if (isDrawExpected && cat === 'soccer') {
        base += ` 예상 스코어가 동점이므로 PICK_WIN_RESULT는 반드시 "무승부"로, PICK_WIN_TEAM은 "무승부"로 출력하라.`;
      }
      return base;
    })()
  : '';

const handicapInstruction = cat === 'lol'
  ? `핸디캡은 세트 기준으로 자체 산출하라.`
  : isDrawExpected
  ? `예상 스코어가 동점이므로 핸디캡 추천 없음. PICK_HANDICAP_VALUE는 "없음"으로 출력하라.`
  : `핸디캡 값은 JS에서 자동 산출된다. PICK_HANDICAP_VALUE는 반드시 "0"으로만 출력하라.`;

// ESPN 결장자/순위 데이터 매칭 (있으면 web_search 대신 이 데이터를 그대로 사용)
// 결장자 심각도 분류: 장기 IL(15일 이상)은 "주요 결장"으로 별도 태깅해서
// AI가 백업급 단기 결장자와 같은 비중으로 다루지 않도록 유도한다.
const MINOR_STATUS = /day-to-day|paternity|bereavement/i;
function classifySeverity(status) {
  return MINOR_STATUS.test(status || '') ? '경미' : '주요';
}
function formatInjuries(list) {
  if (!list || list.length === 0) return null;
  return list
    .map(i => `${i.name}[${classifySeverity(i.status)}](${i.status}${i.detail ? ' - ' + i.detail : ''})`)
    .join(' | ');
}
function formatStanding(s) {
  if (!s) return null;
  const parts = [];
  if (s.rank) parts.push(`순위 ${s.rank}위`);
  if (s.wins || s.losses) parts.push(`${s.wins || 0}승 ${s.losses || 0}패${s.ties ? ` ${s.ties}무` : ''}`);
  if (s.winPercent) parts.push(`승률 ${s.winPercent}`);
  if (s.gamesBehind && s.gamesBehind !== '-') parts.push(`${s.gamesBehind}경기차`);
  if (s.pointsFor && s.pointsAgainst) {
    const diff = (parseFloat(s.pointsFor) - parseFloat(s.pointsAgainst)).toFixed(1);
    parts.push(`득실 ${s.pointsFor}-${s.pointsAgainst}(${diff > 0 ? '+' : ''}${diff})`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

const homeInjuryText = espnInfo ? formatInjuries(espnInfo.injuries?.home) : null;
const awayInjuryText = espnInfo ? formatInjuries(espnInfo.injuries?.away) : null;
const homeStandingText = espnInfo ? formatStanding(espnInfo.standings?.home) : null;
const awayStandingText = espnInfo ? formatStanding(espnInfo.standings?.away) : null;

const hasEspnInjuryData = !!(homeInjuryText || awayInjuryText);
const hasEspnAnyData = hasEspnInjuryData || homeStandingText || awayStandingText;

// ─────────────────────────────────────────────
// KBO 전용 데이터 포맷 (fetch-kbo-context.js가 수집한 선발투수분석/구종분석/라인업)
// ESPN이 KBO를 커버하지 않으므로 별도 데이터 블록으로 구성한다.
// searchOrEspnInstruction이 hasKboData를 참조하므로 그보다 먼저 계산해둔다.
// ─────────────────────────────────────────────
function formatKboPitcher(p) {
  if (!p) return null;
  return `${p.name} (ERA ${p.era}, WAR ${p.war}, ${p.games}경기, 선발평균 ${p.inningsPerStart}이닝, QS ${p.qs}, WHIP ${p.whip})`;
}
function formatKboPitchKind(p) {
  if (!p?.pitches?.length) return null;
  return p.pitches.map(pt => `${pt.type} ${pt.usageRate}(${pt.avgSpeed})`).join(', ');
}
function formatKboLineup(team) {
  if (!team?.lineup?.length) return null;
  return team.lineup.map(b => `${b.order}번 ${b.position} ${b.name}(WAR ${b.war})`).join(', ');
}

const kboHomePitcherText   = kboInfo?.pitcherRecord ? formatKboPitcher(kboInfo.pitcherRecord.home) : null;
const kboAwayPitcherText   = kboInfo?.pitcherRecord ? formatKboPitcher(kboInfo.pitcherRecord.away) : null;
const kboHomePitchKindText = kboInfo?.pitKind ? formatKboPitchKind(kboInfo.pitKind.home) : null;
const kboAwayPitchKindText = kboInfo?.pitKind ? formatKboPitchKind(kboInfo.pitKind.away) : null;
const kboHomeLineupText    = kboInfo?.lineup ? formatKboLineup(kboInfo.lineup.home) : null;
const kboAwayLineupText    = kboInfo?.lineup ? formatKboLineup(kboInfo.lineup.away) : null;
const kboLineupStatusText  = kboInfo?.lineup ? (kboInfo.lineup.lineupConfirmed ? '확정 라인업' : '예상 라인업') : null;

const hasKboData = !!(kboHomePitcherText || kboAwayPitcherText || kboHomeLineupText || kboAwayLineupText);

// ─────────────────────────────────────────────
// NPB 전용 데이터 포맷 (fetch-npb-context.js가 수집한 예고선발투수)
// NPB는 라인업 사전공개가 없어 선발투수 정보만 제공한다.
// ─────────────────────────────────────────────
function formatNpbStarter(p) {
  if (!p?.name) return null;
  return p.name;
}

const npbHomeStarterText = npbInfo?.starters ? formatNpbStarter(npbInfo.starters.home) : null;
const npbAwayStarterText = npbInfo?.starters ? formatNpbStarter(npbInfo.starters.away) : null;

const hasNpbData = !!(npbHomeStarterText || npbAwayStarterText);

// ESPN 데이터가 있으면 web_search 지시 대신 ESPN 데이터를 그대로 사용.
// ESPN 매칭이 안 된 경기(리그 미지원 포함)는 기존 web_search 방식 그대로 유지.
const searchOrEspnInstruction = hasEspnAnyData
  ? `아래 [ESPN 공식 데이터]를 결장자/순위 정보의 근거로 그대로 사용하라. 이 경기는 ESPN 데이터가 확보되어 있으므로 web_search 도구를 사용하지 마라. INJURY_HOME/INJURY_AWAY는 반드시 [ESPN 공식 데이터]의 결장자 목록을 기반으로 작성하고, 목록에 없으면 "없음"으로 표기하라. 목록에 있는데도 임의로 다른 선수를 지어내지 마라.`
  : hasKboData
  ? `아래 [KBO 공식 데이터]를 선발투수/구종/라인업/순위 정보의 근거로 그대로 사용하라. 이 경기는 KBO 공식 데이터가 확보되어 있으므로 web_search 도구를 사용하지 마라. INJURY_HOME/INJURY_AWAY는 KBO 데이터에 결장자 목록이 없으므로 "없음"으로 표기하라.`
  : hasNpbData
  ? `아래 [NPB 공식 데이터]의 예고선발투수 정보를 그대로 사용하라. 이 경기는 NPB 공식 예고선발 데이터가 확보되어 있으므로 web_search 도구를 사용하지 마라. 단, NPB 데이터는 선발투수 이름만 제공하므로 결장자/부상자 정보(INJURY_HOME/INJURY_AWAY)와 선발투수의 상세 기록(ERA 등)은 web_search로 "${match.home} ${match.away} starting pitcher injury 2026"를 검색해서 보강하라.`
  : `지금 당장 아래 1가지를 web_search 도구로 검색하라. 검색 없이 답변 작성 금지.\n\n검색 1: "${match.home} ${match.away} injury report 2026"\n\n검색 완료 후 아래 정보를 참고하여 분석을 작성하라.`;

// 월드컵/올림픽 등 조별리그 방식 대회는 ESPN standings의 rank가 "전체 리그 순위"가 아니라
// "조 내 순위"이므로 표현을 구분한다 ("리그순위" vs "조 순위").
const standingTermKo = isInternationalTournament ? '조 순위' : '리그순위';

const espnDataBlock = hasEspnAnyData ? `
[ESPN 공식 데이터 - 결장자/${standingTermKo}. 신뢰도 높은 1차 데이터이므로 우선 사용하라]
- 홈팀(${aiHomeName}) 결장자: ${homeInjuryText || '없음'}
- 원정팀(${aiAwayName}) 결장자: ${awayInjuryText || '없음'}
- 홈팀(${aiHomeName}) ${standingTermKo}: ${homeStandingText || '정보 없음'}
- 원정팀(${aiAwayName}) ${standingTermKo}: ${awayStandingText || '정보 없음'}

[ESPN 데이터 활용 가이드]
${(homeStandingText || awayStandingText) ? `- 분석 본문에서 순위 데이터를 언급할 때는 반드시 "${standingTermKo}"라는 표현을 사용하라 (예: "현재 ${standingTermKo} 3위"). "전체 순위", "랭킹" 등 다른 표현으로 바꾸지 마라.\n` : ''}${hasEspnInjuryData ? '- 결장자 이름 옆 [주요]/[경미] 태그를 분석 비중에 그대로 반영하라. [주요](15일 이상 장기 결장)는 전력분석에서 비중 있게 다루고, [경미](Day-To-Day 등 단기)는 가볍게 언급하거나 생략해도 된다. 둘을 동일 비중으로 다루지 마라. 태그 표기([주요]/[경미]) 자체는 분석 본문에 그대로 노출하지 말고, 비중 조절 용도로만 참고하라.\n' : ''}${(homeStandingText || awayStandingText) ? `- ${standingTermKo}와 [홈팀/원정팀 최근 경기 DB]의 최근 흐름을 반드시 교차 비교하라. 순위는 낮은데 최근 흐름이 좋으면 "반등 조짐"으로, 순위는 높은데 최근 흐름이 나쁘면 "고점 대비 주춤"으로 서술하는 등 두 정보를 연결해서 서사를 만들어라. 순위와 최근 폼을 따로따로만 언급하지 마라.\n` : ''}${(homeStandingText || awayStandingText) ? '- 득실 수치(괄호 안 +/- 값)는 단순 전적보다 실제 득점력-실점력 격차를 보여주는 지표다. 핸디캡/언더오버 근거를 보강할 때 활용하라.\n' : ''}` : '';

// KBO 순위 텍스트는 standingTermKo 정의 이후에 계산
const kboHomeStandingText  = kboInfo?.standings?.home != null ? `${kboInfo.standings.home}위` : null;
const kboAwayStandingText  = kboInfo?.standings?.away != null ? `${kboInfo.standings.away}위` : null;

const kboDataBlock = hasKboData ? `
[KBO 공식 데이터 - 선발투수 분석/구종분석/라인업(${kboLineupStatusText || '정보 없음'}). koreabaseball.com 공식 1차 데이터이므로 우선 사용하라]
- 홈팀(${aiHomeName}) 선발: ${kboHomePitcherText || '정보 없음'}
- 원정팀(${aiAwayName}) 선발: ${kboAwayPitcherText || '정보 없음'}
- 홈팀 선발 주요 구종: ${kboHomePitchKindText || '정보 없음'}
- 원정팀 선발 주요 구종: ${kboAwayPitchKindText || '정보 없음'}
- 홈팀 ${standingTermKo}: ${kboHomeStandingText || '정보 없음'}
- 원정팀 ${standingTermKo}: ${kboAwayStandingText || '정보 없음'}
- 홈팀 라인업(${kboLineupStatusText || '정보 없음'}): ${kboHomeLineupText || '정보 없음'}
- 원정팀 라인업(${kboLineupStatusText || '정보 없음'}): ${kboAwayLineupText || '정보 없음'}

[KBO 데이터 활용 가이드]
- 선발투수 ERA/WAR/QS/WHIP 수치를 근거로 양 선발투수의 우열을 분석 본문에 명시하라.
- 구종 데이터가 있으면 주무기 구종과 평균구속을 언급해 투수 스타일을 설명하라.
- 라인업이 "확정 라인업"이면 분석 신뢰도를 높여 단정적으로 서술하고, "예상 라인업"이면 변동 가능성이 있다는 점을 짧게 언급하라.
- 타순별 WAR 수치를 활용해 상/하위 타선의 파괴력 차이를 비교 분석에 반영하라.
` : '';

const npbDataBlock = hasNpbData ? `
[NPB 공식 데이터 - 예고선발투수(前日 発表). npb.jp 공식 데이터이므로 선발투수 이름은 이 데이터를 우선 사용하라. 단 결장자/부상자와 선발투수 상세 기록은 별도 web_search로 보강해야 함]
- 홈팀(${aiHomeName}) 예고선발: ${npbHomeStarterText || '정보 없음'}
- 원정팀(${aiAwayName}) 예고선발: ${npbAwayStarterText || '정보 없음'}

[NPB 데이터 활용 가이드]
- 위 예고선발투수 이름을 그대로 사용하고, web_search로 각 투수의 최근 시즌 성적(ERA, 승패, 최근 등판 결과 등)을 찾아 분석에 반영하라.
- 예고선발은 부상 등 예외 상황이 아니면 변경되지 않으므로, 신뢰도 높은 정보로 취급해 분석 본문에 단정적으로 서술하라.
` : '';




const matchDataPrompt = `
${searchOrEspnInstruction}
${espnDataBlock}
${kboDataBlock}
${npbDataBlock}
[경기 정보]
- 종목: ${cat} ${gameContext}
- 홈팀: ${aiHomeName} (DB 원문: ${match.home})
- 원정팀: ${aiAwayName} (DB 원문: ${match.away})
- ${sportPickRule}
${handicapInstruction ? `- ${handicapInstruction}` : ''}
${ouInstruction ? `- ${ouInstruction}` : ''}

[상대전적 DB - 아래 데이터를 H2H에 그대로 사용하라. 웹 검색 절대 금지]
${h2hContextForAI || '없음 - H2H: ※ H2H 업데이트 예정 으로만 표기'}

[시즌 라벨 안내 - 아래 모든 DB 분석 시 이 표현을 기준으로 사용하라: "${seasonLabel}"]

[홈팀 ${seasonLabel} 전체 DB - ${seasonLabel} 성적(승패, 득점, 홈성적 등) 분석에 사용하라. 이 데이터 외 다른 연도 수치 절대 사용 금지]
${homeAllContext}

[홈팀 최근 경기 DB - 최근 흐름 파악에 사용하라]
${homeRecentContext}

[원정팀 ${seasonLabel} 전체 DB - ${seasonLabel} 성적(승패, 득점, 홈성적 등) 분석에 사용하라. 이 데이터 외 다른 연도 수치 절대 사용 금지]
${awayAllContext}

[원정팀 최근 경기 DB - 최근 흐름 파악에 사용하라]
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
      await new Promise(res => setTimeout(res, 3000));
    }

    const response = await client.responses.create({
  model: "openai/gpt-5.4-mini",

  tools: [
    {
      type: "web_search",
      search_context_size: "medium"
    }
  ],

  tool_choice: "auto",

  input: `
${SYSTEM_RULES_PROMPT}

${matchDataPrompt}
`
});

    const aiResponse =
      response.output_text || "";

    if (aiResponse.length > 500) {
      const saved = await savePost(savePath, aiResponse, match, dateShort, cat, dateOnly, h2hContent, aiHomeName, aiAwayName, homeRecentMatches, awayRecentMatches, h2hHistory, expectedScores);
      if (saved) {
        console.log(`✅ Router One 성공 (${attempt}차 시도): ${match.home} vs ${match.away}`);
        success = true;
        break; // 성공하면 재시도 루프 종료
      } else {
        console.warn(`⚠️ [저장 실패] ${attempt}차 시도 저장 거부됨: ${match.home} vs ${match.away}`);
      }
    } else {
      console.warn(`⚠️ [응답 짧음] ${attempt}차 시도 응답 길이 부족 (${aiResponse.length}자): ${match.home}`);

      // ── 진단 로그: 다음에 같은 문제가 재현되면 정확한 원인을 파악하기 위함 ──
      try {
        console.warn(`   [진단] status: ${response.status ?? '(없음)'}`);
        if (response.incomplete_details) {
          console.warn(`   [진단] incomplete_details: ${JSON.stringify(response.incomplete_details)}`);
        }
        if (Array.isArray(response.output)) {
          const outputTypes = response.output.map(o => o.type);
          console.warn(`   [진단] output 아이템 타입: [${outputTypes.join(', ')}]`);
          // 텍스트 없이 도구 호출(web_search_call 등)만 있는 케이스인지 확인
          const hasToolCallOnly = outputTypes.length > 0 && !outputTypes.includes('message');
          if (hasToolCallOnly) {
            console.warn(`   [진단] → 도구 호출만 있고 최종 텍스트 메시지가 없음 (web_search 관련 가능성)`);
          }
        } else {
          console.warn(`   [진단] response.output 없음 또는 배열 아님`);
        }
      } catch (diagErr) {
        console.warn(`   [진단 로그 실패] ${diagErr.message}`);
      }
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
  retryQueue.push({ match, dateShort, cat, dateOnly, savePath, h2hContent, homeRecentMatches, awayRecentMatches, h2hHistory, expectedScores });
  console.warn(`🕐 [재시도 큐 등록] ${match.home} vs ${match.away} (현재 ${retryQueue.length}건)`);
}
} // else (cat 판별) 닫기
} // for (filteredMatches) 닫기

  } catch (error) {
    console.error("❌ 시스템 오류:", error.message);
  }
}

async function analyzeMatchesRetry() {
  console.log(`\n🔁 [재분석 시작] 실패 경기 ${retryQueue.length}건 재처리`);
  await new Promise(res => setTimeout(res, 10000));

  for (const item of retryQueue) {
    const { match, dateShort, cat, dateOnly, savePath, h2hContent, homeRecentMatches, awayRecentMatches, h2hHistory, expectedScores } = item;
    const aiHomeName = TEAM_NAME_MAP[match.home] || match.home;
    const aiAwayName = TEAM_NAME_MAP[match.away] || match.away;
    const gameContext = cat === 'lol' ? "이 경기는 '리그오브레전드(롤)' 이스포츠 경기다." : "";

    const sportPickRule = cat === 'lol'
  ? `핸디캡과 오버언더 수치는 반드시 세트(set) 기준. 수치 뒤에 '세트'를 붙여라. (예: -1.5 세트, 2.5 세트)`
  : cat === 'volleyball'
  ? `배구다. 핸디캡과 오버언더 수치는 반드시 세트(set) 기준. 수치 뒤에 '세트'를 붙여라. (예: -1.5 세트, 3.5 세트)`
  : cat === 'basketball'
  ? `농구다. 핸디캡은 양 팀 전력 차를 분석해 -2.5~-15.5 범위에서 0.25 단위 소수점으로 산출하라. 정수 출력 절대 금지. 오버언더는 양 팀 각각 최근 5경기 최고/최저 득점 제거 후 평균을 구한 뒤 (홈팀 평균 + 원정팀 평균) ÷ 2 로 산출하고 155.5~215.5 범위에서 0.5 단위로 반올림하라. (예: 155.5, 156.0, 156.5)`
  : cat === 'baseball'
  ? `야구다. 핸디캡은 -1.5 또는 +1.5 중 선택. 오버언더는 양 팀 각각 최근 5경기 최고/최저 득점 제거 후 평균을 구한 뒤 (홈팀 평균 + 원정팀 평균) ÷ 2 로 산출하고 6.5~10.5 범위에서 0.5 단위로 반올림하라.`
  : `핸디캡과 오버언더 수치 뒤에 '세트'를 절대 붙이지 마라. 오버언더는 양 팀 각각 최근 5경기 최고/최저 득점 제거 후 평균을 구한 뒤 (홈팀 평균 + 원정팀 평균) ÷ 2 로 산출하고 0.5 단위로 반올림하라.`;

    const retryPrompt = `
[재분석 요청]
이전 응답이 유효하지 않아 재분석합니다. 반드시 아래 형식 그대로 모든 키를 출력하세요.

${gameContext}
- 홈팀: ${aiHomeName}
- 원정팀: ${aiAwayName}
- 리그: ${match.league}
- ${sportPickRule}
`;

    try {
    const retryResponse = await client.responses.create({
  model: "openai/gpt-5.4-mini",

  tools: [
    {
      type: "web_search",
      search_context_size: "medium"
    }
  ],

  tool_choice: "auto",

  input: `
${SYSTEM_RULES_PROMPT}

${retryPrompt}
`
});

      const aiResponse =
        retryResponse.output_text || "";

      if (aiResponse.length > 1200) {
        const saved = await savePost(savePath, aiResponse, match, dateShort, cat, dateOnly, h2hContent, aiHomeName, aiAwayName, homeRecentMatches, awayRecentMatches, h2hHistory, expectedScores);
        if (saved) {
          console.log(`✅ [재분석 성공] ${match.home} vs ${match.away}`);
        } else {
          console.error(`❌ [재분석 저장 실패] ${match.home} vs ${match.away}`);
          const failLogPath = path.resolve(__dirname, '../database/failed-matches.log');
          fs.appendFileSync(failLogPath,
            `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] FINAL_FAILED: ${match.home} vs ${match.away} | ${match.league}\n`,
            'utf8'
          );
        }
      } else {
        console.error(`❌ [재분석도 짧음] ${match.home} vs ${match.away} (${aiResponse.length}자)`);

        // ── 진단 로그: 원인 파악용 ──
        try {
          console.warn(`   [진단] status: ${retryResponse.status ?? '(없음)'}`);
          if (retryResponse.incomplete_details) {
            console.warn(`   [진단] incomplete_details: ${JSON.stringify(retryResponse.incomplete_details)}`);
          }
          if (Array.isArray(retryResponse.output)) {
            const outputTypes = retryResponse.output.map(o => o.type);
            console.warn(`   [진단] output 아이템 타입: [${outputTypes.join(', ')}]`);
            const hasToolCallOnly = outputTypes.length > 0 && !outputTypes.includes('message');
            if (hasToolCallOnly) {
              console.warn(`   [진단] → 도구 호출만 있고 최종 텍스트 메시지가 없음 (web_search 관련 가능성)`);
            }
          } else {
            console.warn(`   [진단] response.output 없음 또는 배열 아님`);
          }
        } catch (diagErr) {
          console.warn(`   [진단 로그 실패] ${diagErr.message}`);
        }
      }
      await new Promise(res => setTimeout(res, 8000));
    } catch (err) {
      console.error(`❌ [재분석 오류] ${match.home} vs ${match.away}`, err.message);
    }
  }
  console.log(`✅ [재분석 완료] ${retryQueue.length}건 처리 종료`);
}

async function savePost(savePath, aiText, match, dateShort, cat, dateOnly, h2hContent, aiHomeName, aiAwayName, homeRecentMatches = [], awayRecentMatches = [], h2hHistory = [], expectedScores = null) {

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
// ✅ [부상], [결장] 은 실제 결장자 정보 표기에 쓰일 수 있으므로 필터에서 제외
if (aiText.includes('[가상') || aiText.includes('선수명]') || aiText.includes('[가상선수명]')) {
  console.error(`❌ [환각 감지] 가상 선수명 플레이스홀더 발견: ${match.home}`);
  return false;
}

  // [검증 0] aiHomeName/aiAwayName에 img 태그나 URL이 포함된 경우 강제 교체
  if (aiHomeName.includes('<img') || aiHomeName.includes('http')) {
    console.warn(`⚠️ [팀명 오염] aiHomeName에 img/URL 감지 → TEAM_NAME_MAP으로 교체: ${match.home}`);
    aiHomeName = TEAM_NAME_MAP[match.home] || match.home;
  }
  if (aiAwayName.includes('<img') || aiAwayName.includes('http')) {
    console.warn(`⚠️ [팀명 오염] aiAwayName에 img/URL 감지 → TEAM_NAME_MAP으로 교체: ${match.away}`);
    aiAwayName = TEAM_NAME_MAP[match.away] || match.away;
  }

  // 1. 기초 정제 및 독백 제거
  let cleanedText = aiText.replace(/```markdown|```/g, "").trim();
  const junkPatterns = [
    /초기 검색에서.*?\n?/g, /더 구체적인 검색을.*?\n?/g,
    /검색 결과를 분석해보니.*?\n?/g, /검색을 진행하겠습니다.*?\n?/g,
    /확인하겠습니다.*?\n?/g, /분석하겠습니다.*?\n?/g,
    /찾아보겠습니다.*?\n?/g, /살펴보겠습니다.*?\n?/g,
    /나는\s.{0,80}하겠습니다[.]?\n?/g, /저는\s.{0,80}하겠습니다[.]?\n?/g,
    /먼저\s.{0,80}(하겠습니다|수행하겠습니다|검색하겠습니다)[.]?\n?/g,
    /.*바탕으로.{0,80}하겠습니다[.]?\n?/g,
    /.*지침을\s*(정확히\s*)?따르고.*\n?/g,
    /.*지시를\s*(정확히\s*)?따르고.*\n?/g,
  ];
  junkPatterns.forEach(p => { cleanedText = cleanedText.replace(p, ""); });

  // 2. 키=값 추출
  // ⚠️ AI가 가끔 라벨 사이 줄바꿈 없이 한 줄로 이어 출력하는 경우가 있어,
  // 줄바꿈 유무에 의존하지 않고 알려진 라벨 목록을 기준으로 다음 섹션 시작을 인식한다.
  const ALL_LABELS = [
    'HOME_ANALYSIS', 'AWAY_ANALYSIS', 'HOME_POWER', 'AWAY_POWER', 'H2H', 'SUMMARY',
    'INJURY_HOME', 'INJURY_AWAY', 'PICK_WIN_TEAM', 'PICK_WIN_RESULT',
    'PICK_HANDICAP_TEAM', 'PICK_HANDICAP_VALUE', 'PICK_EXPECTED_HOME', 'PICK_EXPECTED_AWAY',
  ];
  const NEXT_LABEL_LOOKAHEAD = ALL_LABELS.join('|');
  const extract = (key) => {
  const m = cleanedText.match(new RegExp(`${key}:\\s*([\\s\\S]+?)(?=\\n?(?:${NEXT_LABEL_LOOKAHEAD}):|$)`));
  return m ? m[1].trim() : '';
};

  const homeAnalysis      = extract('HOME_ANALYSIS');
  const awayAnalysis      = extract('AWAY_ANALYSIS');
  const homePowerRaw      = extract('HOME_POWER');
  const awayPowerRaw      = extract('AWAY_POWER');
  const h2hRaw            = extract('H2H');
  const summary           = extract('SUMMARY');
  const injuryHome        = extract('INJURY_HOME');
  const injuryAway        = extract('INJURY_AWAY');
  const pickWinTeam       = extract('PICK_WIN_TEAM');
  const pickWinResult     = extract('PICK_WIN_RESULT');
  const pickHandicapTeam  = extract('PICK_HANDICAP_TEAM');
  const pickHandicapValue = extract('PICK_HANDICAP_VALUE');
  const pickExpectedHome  = extract('PICK_EXPECTED_HOME');
  const pickExpectedAway  = extract('PICK_EXPECTED_AWAY');

  // 3. 필수 값 검증
  if (!homeAnalysis || !awayAnalysis || !summary) {
  console.error(`❌ [필수값 누락] HOME_ANALYSIS/AWAY_ANALYSIS/SUMMARY 없음: ${match.home}`);
  return false;
}
if (!pickWinTeam || !pickHandicapValue) {
  console.error(`❌ [픽 누락] PICK 항목 빈값: ${match.home} | WIN:${pickWinTeam} HANDICAP:${pickHandicapValue}`);
  return false;
}
const homeAnalysisSentences = homeAnalysis.split(/(?<=[.!?])\s+/).filter(Boolean).length;
const awayAnalysisSentences = awayAnalysis.split(/(?<=[.!?])\s+/).filter(Boolean).length;
if (homeAnalysisSentences < 3 || awayAnalysisSentences < 3) {
  console.error(`❌ [분석 부실] 문장 수 부족: 홈 ${homeAnalysisSentences}문장 / 원정 ${awayAnalysisSentences}문장 → ${match.home}`);
  return false;
}

  // 4. 무승부 차단 (축구 외)
  const NO_DRAW_SPORTS = ['baseball', 'basketball', 'hockey', 'volleyball', 'lol'];
  let finalPickWinTeam   = pickWinTeam;
  let finalPickWinResult = pickWinResult;
  if (cat && NO_DRAW_SPORTS.includes(cat) && pickWinTeam === '무승부') {
    finalPickWinTeam   = pickHandicapTeam || aiHomeName;
    finalPickWinResult = '승';
    console.warn(`⚠️ [무승부 차단] ${cat} → '${finalPickWinTeam} 승'으로 교체`);
  }

  // 5. 핸디캡/오버언더 0.5단위 보정 함수
  const roundToHalf = (val) => {
    const n = parseFloat(String(val).replace('+', ''));
    if (isNaN(n)) return null;
    return (Math.round(n * 2) / 2).toFixed(1);
  };

  // 예상스코어: AI가 출력한 값 그대로 사용 (JS 계산값을 지시했으므로 그대로)
  let finalExpectedHome = (pickExpectedHome && pickExpectedHome !== '없음') ? pickExpectedHome : '';
  let finalExpectedAway = (pickExpectedAway && pickExpectedAway !== '없음') ? pickExpectedAway : '';

  // 동점 보정 (축구 제외, 픽 승자 기준)
  if (cat !== 'soccer' && finalExpectedHome && finalExpectedAway) {
    const eh = parseInt(finalExpectedHome);
    const ea = parseInt(finalExpectedAway);
    if (!isNaN(eh) && !isNaN(ea) && eh === ea) {
      const bonus = cat === 'basketball' ? 3 : 1;
      const homeNames = [match.home, aiHomeName, TEAM_NAME_MAP[match.home]].filter(Boolean).map(n => n.toLowerCase());
      const winnerIsHome = homeNames.some(n => finalPickWinTeam.toLowerCase().includes(n) || n.includes(finalPickWinTeam.toLowerCase()));
      if (winnerIsHome) {
        finalExpectedHome = String(eh + bonus);
      } else {
        finalExpectedAway = String(ea + bonus);
      }
    }
  }

  // 승자 픽 기준 예상스코어 방향 보정 (축구 무승부 제외)
  // AI 픽 승자와 예상스코어 승자가 다르면 점수 차를 유지한 채 뒤집기
  if (cat !== 'soccer' && finalExpectedHome && finalExpectedAway && finalPickWinTeam) {
    const eh = parseInt(finalExpectedHome);
    const ea = parseInt(finalExpectedAway);
    if (!isNaN(eh) && !isNaN(ea)) {
      const homeNames = [match.home, aiHomeName, TEAM_NAME_MAP[match.home]].filter(Boolean).map(n => n.toLowerCase());
const winnerIsHome = homeNames.some(n =>
  finalPickWinTeam.toLowerCase().includes(n) || n.includes(finalPickWinTeam.toLowerCase())
);
      const scoreWinnerIsHome = eh > ea;
      // 픽 승자와 스코어 승자가 다른 경우 뒤집기
      if (winnerIsHome !== scoreWinnerIsHome) {
        finalExpectedHome = String(ea);
        finalExpectedAway = String(eh);
      }
    }
  }

  // 축구 동점 스코어 상한선 보정 (3:3 이상 → 2:2)
  if (cat === 'soccer' && finalExpectedHome && finalExpectedAway) {
    const eh = parseInt(finalExpectedHome);
    const ea = parseInt(finalExpectedAway);
    if (!isNaN(eh) && !isNaN(ea) && eh === ea && eh >= 3) {
      finalExpectedHome = '2';
      finalExpectedAway = '2';
    }
  }

  // 핸디캡 보정 (동점 보정된 finalExpectedHome/Away 기준으로 산출)
  let finalHandicapValue = '';

  if (finalPickWinResult === '무승부' || finalPickWinTeam === '무승부' || finalPickWinTeam === '') {
    // 축구 무승부 → 핸디캡 없음
    finalHandicapValue = '';
  } else {
    const expHome = finalExpectedHome ? parseInt(finalExpectedHome) : null;
    const expAway = finalExpectedAway ? parseInt(finalExpectedAway) : null;

    if (expHome !== null && expAway !== null) {
      const diff = Math.abs(expHome - expAway);
      // calcHandicapValue 로직 인라인 (보정된 스코어 기준)
      let absVal = '0.5';
      if (cat === 'soccer' || cat === 'hockey') {
        absVal = diff <= 1 ? '0.5' : diff === 2 ? '1.5' : '2.5';
      } else if (cat === 'baseball') {
        absVal = diff <= 1 ? '0.5' : diff <= 3 ? '1.5' : '2.5';
      } else if (cat === 'basketball') {
        absVal = diff <= 4 ? '2.5' : diff <= 9 ? '5.5' : diff <= 14 ? '8.5' : diff <= 19 ? '11.5' : '15.5';
      } else if (cat === 'volleyball') {
        absVal = diff === 3 ? '2.5' : diff === 2 ? '1.5' : '0.5';
      }
      finalHandicapValue = `-${absVal}`;
    } else {
      finalHandicapValue = '-0.5';
    }
  }

  // 5-1. 언더오버 산출 (농구/야구 전용): 예상 합산 점수를 기준으로 라인/방향 결정
  const OU_SPORTS = ['basketball', 'baseball'];
  let finalOuValue = '';
  let finalOuDirection = '';

  if (OU_SPORTS.includes(cat) && expectedScores && finalExpectedHome && finalExpectedAway) {
    const roundedTotal = parseInt(finalExpectedHome) + parseInt(finalExpectedAway);
    const avgTotal = (expectedScores.homeAvg ?? 0) + (expectedScores.awayAvg ?? 0);

    // 반올림 전 평균 합산이 반올림된 최종 예상치보다 크면 '오버' 쪽 흐름으로 판단
    finalOuDirection = avgTotal >= roundedTotal ? '오버' : '언더';

    let ouLine = finalOuDirection === '오버' ? roundedTotal - 0.5 : roundedTotal + 0.5;

    // 종목별 현실적인 범위로 clamp (calcOuValue와 동일 기준)
    if (cat === 'basketball') ouLine = Math.min(215.5, Math.max(155.5, ouLine));
    if (cat === 'baseball')   ouLine = Math.min(15.5, Math.max(4.5, ouLine));

    finalOuValue = ouLine.toFixed(1);

    // 언더오버로 표기하는 종목은 예상 스코어(홈:원정) 위젯을 노출하지 않음
    finalExpectedHome = '';
    finalExpectedAway = '';
  }

  // 6. 팀명 일괄 치환 함수
  const replaceTeamNames = (text) => {
    if (!text) return '';
    let result = text;
    for (const [eng, kor] of Object.entries(TEAM_NAME_MAP)) {
      if (!eng || !kor || eng === kor) continue;
      const escaped = eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'gi'), kor);
    }
    return result;
  };

  const homeAnalysisKor   = replaceTeamNames(homeAnalysis);
  const awayAnalysisKor   = replaceTeamNames(awayAnalysis);
  const summaryKor        = replaceTeamNames(summary);
  const finalPickWinTeamKor      = (finalPickWinTeam === '무승부') ? '' : replaceTeamNames(finalPickWinTeam);
  const finalPickHandicapTeamKor = (pickHandicapTeam === '무승부' || finalHandicapValue === '') ? '' : replaceTeamNames(pickHandicapTeam);
  const homePowerItems  = homePowerRaw ? homePowerRaw.split('|').map(s => replaceTeamNames(s.trim())).filter(Boolean) : [];
  const awayPowerItems  = awayPowerRaw ? awayPowerRaw.split('|').map(s => replaceTeamNames(s.trim())).filter(Boolean) : [];
  const h2hItems = (h2hHistory && h2hHistory.length > 0)
  ? h2hHistory.map(h => {
      const d = new Date(h.date).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, '');
      const score = (typeof h.homeScore === 'number' && typeof h.awayScore === 'number') ? `${h.homeScore}-${h.awayScore}` : (h.score || '-');
      return {
        date: d,
        home: TEAM_NAME_MAP[h.home] || h.home,
        away: TEAM_NAME_MAP[h.away] || h.away,
        score,
      };
    })
  : [];

  // 7. 리그명 치환
  const datePartsForText = dateShort.split('/');
  const displayDate = `${parseInt(datePartsForText[1], 10)}월 ${parseInt(datePartsForText[2], 10)}일`;

  let leagueName = convertLeagueName(match.league);

  // 8. 국가명 결정
  const leagueCountryOverrides = {
    "OFC PRO LEAGUE": "오세아니아", "AFC CHAMPIONS LEAGUE": "아시아",
    "UEFA CHAMPIONS LEAGUE": "유럽", "UEFA Europa League": "유럽", "LEC": "유럽",
    "K LEAGUE 1": "대한민국", "CONMEBOL LIBERTADORES": "남미",
    "FRIENDLY INTERNATIONAL": "국제", "INTERNATIONAL FRIENDLY": "국제",
    "CPBL": "대만", "KBO": "대한민국", "CONCACAF CHAMPIONS LEAGUE": "북중미",
    "ESPORTS WORLD CUP PLAYOFFS": "국제", "ESPORTS WORLD CUP": "국제",
    "WORLD CHAMPIONSHIP": "국제", "KHL": "러시아", "NHL": "미국",
    "ASIA CHAMPIONS LEAGUE": "국제", "EUROPE": "유럽", "LCS": "북미",
    "CONMEBOL SUDAMERICANA": "남미", "IL": "미국",
    "NATIONS LEAGUE WOMEN": "국제", "NATIONS LEAGUE": "국제",
    "EUROPEAN LEAGUE WOMEN": "유럽", "EUROPEAN LEAGUE": "유럽",
    "WORLD CUP - WOMEN - QUALIFICATION EUROPE": "국제",
    "FRIENDLIES": "국제", "ASEAN CHAMPIONSHIP": "국제",
  };
  const upperLeagueName = (match.league || "").toUpperCase();
  let country = leagueCountryOverrides[upperLeagueName]
    || (["WORLD","INTERNATIONAL"].includes(match.country?.toUpperCase()) ? "국제" : null)
    || COUNTRY_MAP[match.country] || match.country;
  if (['MLB','NBA','NHL','MLS'].some(lg => leagueName.toUpperCase().includes(lg))) country = "미국";
  if (['KBO','KBL','V-LEAGUE','LCK'].some(lg => leagueName.toUpperCase().includes(lg))) country = "대한민국";

  // 9. 메타 정보
  const descHomeName = TEAM_NAME_MAP[match.home] || aiHomeName;
  const descAwayName = TEAM_NAME_MAP[match.away] || aiAwayName;
  const extractedDesc = `${descHomeName} vs ${descAwayName} 경기분석 및 승부예측 입니다. 팀 전력, 선발라인업, 최근 성적, 상대전적(H2H),부상.결장자정보, 경기 통계, 최신 스포츠분석 및 추천 스포츠픽을 픽천국에서 확인하세요.`;
  const finalTitle = `${aiHomeName} vs ${aiAwayName} 경기분석·라인업·결장자·통계·승부예측 (${displayDate}) | ${leagueName} - 픽천국`;
  const safeHomeNameForSlug = getSafeLogoName(match.home);

  // 최근 경기 데이터 직렬화 (slug.astro에서 렌더링)
  const homeRecentJson = JSON.stringify(homeRecentMatches.slice(0, 5).map(m => ({
    date: new Date(m.date).toLocaleDateString('ko-KR', { year:'2-digit', month:'2-digit', day:'2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, ''),
    home: TEAM_NAME_MAP[m.home] || m.home,
    away: TEAM_NAME_MAP[m.away] || m.away,
    score: (typeof m.homeScore === 'number' && typeof m.awayScore === 'number') ? `${m.homeScore}-${m.awayScore}` : (m.score || '-'),
    result: (() => {
  const isHomeTeam = m.home === match.home;
  const my = isHomeTeam ? Number(m.homeScore) : Number(m.awayScore);
  const op = isHomeTeam ? Number(m.awayScore) : Number(m.homeScore);
  if (isNaN(my) || isNaN(op)) return '-';
  return my > op ? '🟢승' : my < op ? '🔴패' : '🟡무';
})()
  })));

  const awayRecentJson = JSON.stringify(awayRecentMatches.slice(0, 5).map(m => ({
    date: new Date(m.date).toLocaleDateString('ko-KR', { year:'2-digit', month:'2-digit', day:'2-digit', timeZone: 'Asia/Seoul' }).replace(/\s/g, '').replace(/\.$/, ''),
    home: TEAM_NAME_MAP[m.home] || m.home,
    away: TEAM_NAME_MAP[m.away] || m.away,
    score: (typeof m.homeScore === 'number' && typeof m.awayScore === 'number') ? `${m.homeScore}-${m.awayScore}` : (m.score || '-'),
    result: (() => {
      const isHomeTeam = m.home === match.away;
      const my = isHomeTeam ? Number(m.homeScore) : Number(m.awayScore);
      const op = isHomeTeam ? Number(m.awayScore) : Number(m.homeScore);
      if (isNaN(my) || isNaN(op)) return '-';
      return my > op ? '🟢승' : my < op ? '🔴패' : '🟡무';
    })()
  })));

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
homeLogo: "${match.homeLogo || ''}"
awayLogo: "${match.awayLogo || ''}"
homeAnalysis: "${homeAnalysisKor.replace(/"/g, "'")}"
awayAnalysis: "${awayAnalysisKor.replace(/"/g, "'")}"
homePower: "${homePowerItems.join('|').replace(/"/g, "'")}"
awayPower: "${awayPowerItems.join('|').replace(/"/g, "'")}"
h2h: '${JSON.stringify(h2hItems).replace(/'/g, "\u2019")}'
summary: "${summaryKor.replace(/"/g, "'")}"
homeRecent: '${homeRecentJson.replace(/'/g, "\u2019")}'
awayRecent: '${awayRecentJson.replace(/'/g, "\u2019")}'
injuryHome: "${injuryHome.replace(/"/g, "'")}"
injuryAway: "${injuryAway.replace(/"/g, "'")}"
pickWinTeam: "${finalPickWinTeamKor}"
pickWinResult: "${finalPickWinResult}"
pickHandicapTeam: "${finalPickHandicapTeamKor}"
pickHandicapValue: "${finalHandicapValue}"
pickExpectedHome: "${finalExpectedHome}"
pickExpectedAway: "${finalExpectedAway}"
pickOuValue: "${finalOuValue}"
pickOuDirection: "${finalOuDirection}"
---
`;

  fs.writeFileSync(savePath, content, 'utf8');
  console.log(`✅ [저장성공] ${finalTitle}`);
  return true;
}

analyzeMatches();