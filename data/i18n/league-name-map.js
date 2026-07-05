// data/i18n/league-name-map.js
//
// 리그명은 팀명과 달리 "Regular Season", "Playoffs", "Women", "U18" 같은
// 공통 접미어 조합이 매우 많아서, 971개를 전부 하드코딩하는 대신
// (1) 잘 알려진 리그는 직접 매핑
// (2) 나머지는 공통 토큰을 치환하는 방식으로 처리합니다.
// 두 방식 다 안 걸리면 원문(영문) 그대로 보여줍니다.

// ── 1. 잘 알려진 리그 직접 매핑 ──────────────────────────────
export const EXACT_LEAGUE_MAP = {
  // 야구
  "MLB": "MLB",
  "IL": "인터내셔널리그",
  "PCL": "퍼시픽코스트리그",
  "LMB": "멕시칸리그",
  "LMBP": "멕시칸퍼시픽리그",
  "NPB": "NPB",
  "KBO": "KBO",
  "CPBL": "대만프로야구",
  "Liga Elite": "엘리트리그",
  "Serie A1": "세리에 A1",
  "Hoofdklasse": "호프트클라서",
  "SM-sarja": "SM-sarja",
  "Elitserien": "엘리트세리엔",
  "Federations Cup": "페더레이션스컵",
  "European Cup": "유러피언컵",
  "Confederation Cup": "컨페더레이션컵",

  // 하키
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
  "Beijer Hockey Games": "베이예르 하키 게임스",
  "DEL": "DEL",
  "DEL 2": "DEL2",
  "SHL": "SHL",
  "LNAH": "LNAH",
  "PWHL": "PWHL",
  "Metal Ligaen": "메탈리가엔",
  "World Championship": "월드챔피언십",

  // 농구
  "NBA": "NBA",
  "NBA Salt Lake City Summer League": "NBA 썸머리그",
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

  // 배구
  "PlusLiga": "플러스리가",
  "SuperLega": "수페르레가",
  "Eredivisie": "에레디비지",
  "Efeler Ligi": "에페르리기",
  "EuroMillions League": "유로밀리언스리그",
  "Nations League": "발리볼 네이션스리그",
  "Nations League Women": "발리볼 네이션스리그 여자부",

  // 공통
  "World Cup": "월드컵",
  "Champions League": "챔피언스리그",
  "Friendly International": "국가대표 친선경기",
  "Friendly International Women": "국가대표 친선경기 여자부",
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
