// data/i18n/lol-league-allowlist.js
//
// api-sports/pandascore가 sport: "lol"로 태그해서 주는 데이터 안에는
// 스타크래프트/CS/발로란트/도타2/로켓리그 등 다른 게임 대회가 섞여 있습니다.
// 리그명만 보고는 완벽하게 구분이 안 되지만, 확실한 것들 위주로 허용목록을
// 만들어서 "진짜 LoL"만 골라냅니다. 애매한 리그는 일단 제외해뒀어요(안전 우선).
//
// 화면에서 "이건 LoL이 맞다/아니다"를 발견하시면 이 배열에 추가/삭제하는 식으로
// 바로 보정하시면 됩니다.

export const LOL_LEAGUE_KEYWORDS = [
  "LCK",
  "LPL",
  "LEC",
  "LCS",
  "LJL",
  "TCL",
  "VCS",
  "CBLOL",
  "LLA",
  "PCS",
  "LFL",
  "NLC",
  "HLL",
  "EBL",
  "LRS",
  "LRN",
  "CN League",
  "Prime League",
  "Arabian League",
  "Rift Legends",
  "Road Of Legends",
  "Circuito Desafiante",
  "North American Challengers League",
  "Europe MENA League",
  "TESFED League",
  "United21",
  "EMEA Masters",
  "Mid-Season Invitational",
  "Mid Season Cup",
  "Worlds",
  "MSI",
];

export function isRealLolLeague(leagueName) {
  if (!leagueName) return false;
  return LOL_LEAGUE_KEYWORDS.some((kw) => leagueName.includes(kw));
}