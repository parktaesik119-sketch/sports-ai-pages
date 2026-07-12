// scripts/formation-common.js
// 선수별 세부 포지션 코드(CB/CDM/CF 등)를 세어서 "DF-MF-FW" 형태의 포메이션 문자열을
// 유추하는 공용 로직. footystats와 ESPN 둘 다 "4-2-3-1" 같은 포메이션 문자열을 직접
// 안 주는 경기가 있어서(하위 리그 등 커버리지가 얕은 경우), 라인업의 세부 포지션
// 코드로부터 역산하는 용도로 양쪽에서 공유해서 쓴다.
//
// UEFA/SofaScore 등 다른 소스가 이미 주는 formation 문자열과 정확히 같은 포맷
// ("4-3-3" 등, 세그먼트 3~4개)이라 homeFormation/awayFormation 필드에 그대로
// 섞어 써도 된다.
//
// 분류 기준(실사용 테스트로 검증):
// - DF: CB, LB, RB, WB, LWB, RWB
// - MF: CDM, CAM, CM, DM, AM, LM, RM
// - FW: CF, ST, LF, RF, LW, RW  ← 윙어(LW/RW)는 미드필더가 아니라 공격진으로 분류.
//   (실제 스크린샷 두 건을 손으로 검산해서 이 분류가 "윙어=미드필더"보다 훨씬
//   자연스러운 포메이션이 나오는 것으로 확인함 — 후자로 하면 서로 다른 두 팀이
//   전부 4-5-1로 뭉뚱그려지는 등 부자연스러운 결과가 나왔음)
// GK는 정확히 1명이어야 하고, 나머지 10명이 전부 DF/MF/FW 중 하나로 분류되며
// DF/FW가 둘 다 0보다 커야만 신뢰할 수 있는 것으로 보고 결과를 낸다.
// 이 조건을 못 채우면(포지션 코드 누락 등) null을 반환해서 억지로 틀린 값을
// 만들어내지 않는다.
const DF_POSITIONS = new Set(['CB', 'LB', 'RB', 'WB', 'LWB', 'RWB', 'DF']);
const MF_POSITIONS = new Set(['CDM', 'CAM', 'CM', 'DM', 'AM', 'MF', 'LM', 'RM']);
const FW_POSITIONS = new Set(['CF', 'ST', 'LF', 'RF', 'LW', 'RW', 'FW']);

export function deriveFormationFromLineup(players) {
  if (!players || players.length === 0) return null;

  let gk = 0, df = 0, mf = 0, fw = 0, unknown = 0;
  for (const p of players) {
    const pos = (p.position || '').toUpperCase().trim();
    if (pos === 'GK') gk++;
    else if (DF_POSITIONS.has(pos)) df++;
    else if (MF_POSITIONS.has(pos)) mf++;
    else if (FW_POSITIONS.has(pos)) fw++;
    else unknown++;
  }

  if (gk !== 1) return null;              // GK가 정확히 1명이 아니면 데이터 이상함
  // ⚠️ 일부 선수 포지션이 "-"(정보 없음)로 오는 경우가 실사용에서 확인됨
  // (11명 중 1명 정도는 흔함) — 그때마다 통째로 포기하면 너무 자주 실패하니, 최대 1명까지는
  // 무시하고 나머지로 계산한다. 2명 이상 미상이면 신뢰도가 너무 떨어져서 포기한다.
  if (unknown > 1) return null;
  // 정렬 로직(sortForPitchView 등)도 미분류 포지션을 미드필더 취급해서 정렬하므로,
  // 여기서도 mf에 합산해야 배열 길이(11명)와 포메이션 숫자 합이 어긋나지 않는다.
  mf += unknown;
  if (df + mf + fw < 9) return null;      // 분류된 필드 플레이어가 너무 적으면 불완전한 라인업
  if (df === 0 || fw === 0) return null;  // 수비/공격이 0명인 포메이션은 있을 수 없음

  // 미드필더가 5명 이상이면 한 줄에 몰아넣지 않고 두 줄(수비형/공격형)로 나눠서
  // "3-6-1" 대신 "3-3-3-1"처럼 훨씬 자연스러운 포메이션 모양을 만든다. 소스가
  // CDM/CAM처럼 세부 구분 없이 전부 "CM"으로 뭉뚱그려 줄 때가 많아서, "정확히 누가
  // 수비형이고 누가 공격형인지"까지는 알 수 없다 — 그래서 정렬된 순서 그대로 절반씩
  // 나눈다. 실제 배치와 100% 일치한다는 보장은 없지만, 한 줄에 5~6명이 몰려있는 것보다는
  // 훨씬 자연스러운 모양이 나온다. _slug_.astro의 좌표 생성기가 4구간 포메이션 문자열
  // ("4-2-3-1" 같은)을 이미 지원하므로 형식만 맞추면 별도 프론트 작업 없이 그려진다.
  if (mf >= 5) {
    const deeperMf = Math.floor(mf / 2);
    const advancedMf = mf - deeperMf;
    return `${df}-${deeperMf}-${advancedMf}-${fw}`;
  }

  return `${df}-${mf}-${fw}`;
}