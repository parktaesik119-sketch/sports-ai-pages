// data/i18n/league-name-map.js
//
// 리그명은 팀명과 달리 "Regular Season", "Playoffs", "Women", "U18" 같은
// 공통 접미어 조합이 매우 많아서, 971개를 전부 하드코딩하는 대신
// (1) 잘 알려진 리그는 직접 매핑
// (2) 나머지는 공통 토큰을 치환하는 방식으로 처리합니다.
// 두 방식 다 안 걸리면 원문(영문) 그대로 보여줍니다.
//
// ⚠️ 아래 EXACT_LEAGUE_MAP은 예전 analyze-router-one-git.js의 convertLeagueName()
// 45개 규칙을 전부 흡수해서 만들었습니다. 겹치는 리그는 전부 "예전 번역" 기준으로
// 통일했고(예: Nations League → "네이션스리그", 배구 전용 문구로 좁혀졌던 것 원복),
// 예전엔 있었는데 여기 없던 리그(라리가/세리에 A/프리메이라리가 등 5대 리그급 포함)는
// 전부 새로 추가했습니다.

// ── 1. 잘 알려진 리그 직접 매핑 ──────────────────────────────
export const EXACT_LEAGUE_MAP = {
  // ⚽ 축구 — 5대 리그 및 주요 대회
  "Premier Soccer League": "프리미어리그",
  "PRO LEAGUE": "프리미어리그",
  "Football Premier League": "프리미어리그",
  "Premier League": "프리미어리그",
  "LA LIGA": "라리가",
  "Segunda División": "라리가2",
  "Serie A": "세리에 A",
  "Bundesliga": "분데스리가",
  "2. Bundesliga": "분데스리가2",
  "Primeira Liga": "프리메라리가",
  "Primera División - Apertura": "프리메라디비전",
  "JUPILER PRO LEAGUE": "D1",
  "Premier Division": "D1",
  "Division 1": "D1",
  "B League": "B리그",
  "K League 1": "K1",
  "K League 2": "K2",
  "Major League Soccer": "MLS",
  "African Club Championship": "CAF",
  "AFC ASIAN CUP": "AFC 아시안컵",
  "Challengers League": "CL",

  // ⚽ 국제대회 / 유럽 대항전
  "UEFA Champions League": "UEFA 챔피언스리그",
  "UEFA Champions League Qualification": "UEFA 챔피언스리그 예선",
  "UEFA Europa League": "UEFA 유로파리그",
  "UEFA Europa League Qualification": "유로파리그 예선",
  "Europa League Qualification": "유로파리그 예선",
  "Conference League": "컨퍼런스리그",
  "Conference League Qualification": "컨퍼런스리그 예선",
  "UEFA Europa Conference League": "UEFA 컨퍼런스리그",
  "UEFA Europa Conference League Qualification": "UEFA 컨퍼런스리그 예선",
  "Europa Conference League": "UEFA 컨퍼런스리그",
  "Europa Conference League Qualification": "UEFA 컨퍼런스리그 예선",
  "Champions League": "챔피언스리그",
  "Champions League Qualification": "챔피언스리그 예선",
  "Copa Sudamericana Final": "코파 수다메리카나 결승",
  "Copa Sudamericana Semi Finals": "코파 수다메리카나 준결승",
  "Copa Sudamericana 4th Finals": "코파 수다메리카나 4강",
  "Copa Sudamericana 8th Finals": "코파 수다메리카나 8강",
  "Copa Sudamericana 16th Finals": "코파 수다메리카나 16강",
  "Copa Sudamericana 32th Finals": "코파 수다메리카나 32강",
  "CONMEBOL Sudamericana": "코파 수다메리카나",
  "CONMEBOL Libertadores": "코파 리베르타도레스",
  "Copa Libertadores Final": "코파 리베르타도레스 결승",
  "Copa Libertadores Semi Finals": "코파 리베르타도레스 준결승",
  "Copa Libertadores 4th Finals": "코파 리베르타도레스 4강",
  "Copa Libertadores 8th Finals": "코파 리베르타도레스 8강",
  "Copa Libertadores 16th Finals": "코파 리베르타도레스 16강",
  "Copa Libertadores 32th Finals": "코파 리베르타도레스 32강",
  "Copa Libertadores": "코파 리베르타도레스",
  "Nations League": "네이션스리그",
  "Nations League Women": "네이션스리그(W)",
  "Friendly International": "국제친선",
  "Friendly International Women": "국제친선(W)",
  "Friendlies": "국제친선",
  "World Cup": "월드컵",
  "World Cup - Women": "월드컵 (W)",
  "World Cup - Women - Qualification Europe": "월드컵 예선(W)",

  // 🎮 e스포츠
  "Esports World Cup Playoffs": "EWC 플레이오프",
  "LCK CHALLENGERS LEAGUE": "LCK CL",
  "LCK CHALLENGERS LEAGUE ROUNDS 1-2": "LCK CL",
  "LCK ROUNDS 1-2": "LCK",

  // 🏀 농구
  "NBA": "NBA",
  "NBA Salt Lake City Summer League": "NBA 썸머리그",
  "NBA - Las Vegas Summer League": "NBA 썸머리그",
  "NBA - Orlando Summer League": "NBA 썸머리그",
  "NBA - Sacramento Summer League": "NBA 썸머리그",
  "California Classic": "NBA 썸머리그",
  "NBA W": "WNBA",
  "WNBA": "WNBA",
  "KBL": "KBL",
  "WKBL": "WKBL",
  "Euroleague": "유로리그",
  "Eurocup": "유로컵",
  "EuroBasket": "유로바스켓",
  "ACB": "ACB",
  "Lega A": "레가 A",
  "CBA": "CBA",
  "NBB": "NBB",
  "LKL": "LKL",
  "VTB United League": "VTB 통합리그",
  "ABA League": "ABA리그",
  "ABA League 2": "ABA리그 2",
  "BAL": "BAL",
  "BNXT League": "BNXT리그",
  "Basketbol Süper Ligi": "농구 쉬페르리기",
  "Basket League": "바스켓리그",
  "Energa Basket Liga": "에네르가 바스켓리가",
  "Liga Leumit": "리가 레우밋",
  "MPBL": "MPBL",
  "BSN": "BSN",
  "CIBACOPA": "시바코파",
  "CEBL": "CEBL",
  "BIG3": "BIG3",
  "FIBA Europe Cup": "FIBA 유로컵",

  // ⚾ 야구
  "MLB": "MLB",
  "IL": "트리플A-IL",
  "PCL": "퍼시픽코스트리그",
  "LMB": "멕시칸리그",
  "LMBP": "멕시칸퍼시픽리그",
  "NPB": "NPB",
  "KBO": "KBO",
  "CPBL": "CPBL",
  "Liga Elite": "엘리트리그",
  "Serie A1": "세리에 A1",
  "Hoofdklasse": "호프트클라서",
  "SM-sarja": "SM-sarja",
  "Elitserien": "엘리트세리엔",
  "Federations Cup": "페더레이션스컵",
  "European Cup": "유러피언컵",
  "Confederation Cup": "컨페더레이션컵",

  // 🏒 하키
  "AIHL": "AIHL",
  "AHL": "AHL",
  "ECHL": "ECHL",
  "NHL": "NHL",
  "NZIHL": "NZIHL",
  "MHL": "MHL",
  "USHL": "USHL",
  "VHL": "VHL",
  "KHL": "KHL",
  "QMJHL": "QMJHL",
  "OHL": "OHL",
  "WHL": "WHL",
  "Liiga": "리가",
  "NMHL": "NMHL",
  "Memorial Cup": "메모리얼컵",
  "SPHL": "SPHL",
  "FPHL": "FPHL",
  "Czech Hockey Games": "체코 하키 게임스",
  "Beijer Hockey Games": "유로 하키 투어",
  "DEL": "DEL",
  "DEL 2": "DEL2",
  "SHL": "SHL",
  "LNAH": "LNAH",
  "PWHL": "PWHL",
  "Metal Ligaen": "메탈리가엔",
  "World Championship": "월드챔피언십",

  // 🏐 배구
  "PlusLiga": "플러스리가",
  "SuperLega": "수페르레가",
  "Eredivisie": "에레디비지",
  "Efeler Ligi": "에페르리기",
  "EuroMillions League": "유로밀리언스리그",
};

// ── 2. 공통 접미어/토큰 치환 (긴 것부터 매칭되도록 정렬해서 사용) ──
export const LEAGUE_TOKEN_MAP = [
  ["Regular Season", "정규시즌"],
  ["Group Stage", "조별리그"],
  ["Play-In", "플레이인"],
  ["Playoffs", "플레이오프"],
  ["Playoff", "플레이오프"],
  ["Women", "여자부"],
  ["Division 1", "1부리그"],
  ["Division 2", "2부리그"],
  ["1st Division", "1부리그"],
  ["2nd Division", "2부리그"],
  ["National League", "내셔널리그"],
  ["Super League", "슈퍼리그"],
  ["Superleague", "슈퍼리그"],
  ["Premier League", "프리미어리그"],
  ["Bundesliga North", "분데스리가 북부"],
  ["Bundesliga South", "분데스리가 남부"],
  ["Bundesliga", "분데스리가"],
  ["World Championship", "월드챔피언십"],
  ["World Cup", "월드컵"],
  ["Champions League", "챔피언스리그"],
  ["Qualifier", "예선"],
  ["Qualifiers", "예선"],
  ["Finals", "결승"],
  ["Final", "결승"],
];

/**
 * 리그명을 한글로 변환합니다.
 * 1) 정확히 일치하는 항목이 있으면 그대로 사용
 * 2) 없으면 공통 토큰을 하나씩 치환 시도 (치환이 하나라도 일어나면 그 결과 사용)
 * 3) 둘 다 실패하면 원문(영문) 그대로 반환
 */
export function translateLeagueName(name) {
  if (!name) return name;
  if (EXACT_LEAGUE_MAP[name]) return EXACT_LEAGUE_MAP[name];

  let result = name;
  let changed = false;
  for (const [en, ko] of LEAGUE_TOKEN_MAP) {
    if (result.includes(en)) {
      result = result.split(en).join(ko);
      changed = true;
    }
  }
  return changed ? result : name;
}