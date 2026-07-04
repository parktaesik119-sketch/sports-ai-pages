// data/i18n/team-additions/index.js
//
// 기존 team_name_map.js(TEAM_NAME_MAP)에 이번에 추가한 종목별 매핑을 합칩니다.
// team_name_map.js 파일 자체는 건드리지 않고, 이 파일에서만 병합해서 내보냅니다.
// 나중에 축구/농구/배구 장기 꼬리 팀을 추가할 때도 이 폴더에 파일만 새로 만들고
// 여기서 import + spread 해주면 됩니다.

import TEAM_NAME_MAP from "../../../team_name_map.js"; // 실제 경로에 맞게 조정하세요
import baseballAdditions from "./baseball.js";
import hockeyAdditions from "./hockey.js";
import lolAdditions from "./lol.js";
import basketballAdditions from "./basketball.js";
import volleyballAdditions from "./volleyball.js";

const MERGED_TEAM_NAME_MAP = {
  ...TEAM_NAME_MAP,
  ...baseballAdditions,
  ...hockeyAdditions,
  ...lolAdditions,
  ...basketballAdditions,
  ...volleyballAdditions,
};

export default MERGED_TEAM_NAME_MAP;
