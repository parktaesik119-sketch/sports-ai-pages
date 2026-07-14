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
export const DF_POSITIONS = new Set(['CB', 'LB', 'RB', 'WB', 'LWB', 'RWB', 'DF']);
export const MF_POSITIONS = new Set(['CDM', 'CAM', 'CM', 'DM', 'AM', 'MF', 'LM', 'RM']);
// FW를 다시 두 그룹으로 나눔: 윙어(측면)와 중앙 공격수.
// - WIDE_FW: LW, RW, LF, RF → 실제 배치상 스트라이커보다 한 줄 뒤(측면)에 서는 경우가 많음
// - CENTRAL_FW: CF, ST, FW → 최전방 중앙
// 이렇게 나눠야 "LW+RW+CF+CF+LW=5명"처럼 서로 다른 역할이 섞였을 때 "3-2-5" 같은
// 뭉뚱그린 결과 대신 "3-2-3-2"(수비-미드-윙-스트라이커)처럼 실제 배치에 가까운
// 포메이션 문자열을 만들 수 있다.
export const WIDE_FW_POSITIONS = new Set(['LW', 'RW', 'LF', 'RF']);
export const CENTRAL_FW_POSITIONS = new Set(['CF', 'ST', 'FW']);
// 기존 코드/호출부 호환을 위해 "포지션이 FW 계열인지" 판단할 때는 이 합집합을 그대로 사용.
export const FW_POSITIONS = new Set([...WIDE_FW_POSITIONS, ...CENTRAL_FW_POSITIONS]);

export function deriveFormationFromLineup(players) {
  if (!players || players.length === 0) return null;

  let gk = 0, df = 0, mf = 0, fwWide = 0, fwCentral = 0, unknown = 0;
  for (const p of players) {
    const pos = (p.position || '').toUpperCase().trim();
    if (pos === 'GK') gk++;
    else if (DF_POSITIONS.has(pos)) df++;
    else if (MF_POSITIONS.has(pos)) mf++;
    else if (WIDE_FW_POSITIONS.has(pos)) fwWide++;
    else if (CENTRAL_FW_POSITIONS.has(pos)) fwCentral++;
    else unknown++;
  }
  let fw = fwWide + fwCentral;

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

  // ✅ _slug_.astro의 좌표 생성기(calcPos/makePosFn)를 직접 확인한 결과, 세그먼트
  // 개수에 하드코딩된 제한이 없다("4구간까지만 지원"은 잘못된 추측이었음 — 정정).
  // SVG 좌표를 세그먼트 개수에 맞춰 그때그때 계산하는 구조라 5구간 이상도 문제없이
  // 그려진다. 그래서 미드필더 분리와 윙/중앙 분리를 동시에 적용해도 된다.
  return buildFormationString(df, mf, fwWide, fwCentral);
}

// df/mf/wide/central 개수로부터 최종 포메이션 문자열을 만든다.
// sortLineupForPitchView()와 이 함수가 "같은 줄 순서"를 만들어야 좌표가 어긋나지
// 않으므로, 줄 구성 규칙은 반드시 이 함수 하나로만 관리한다.
function buildFormationString(df, mf, fwWide, fwCentral) {
  const segments = [df];
  const splitFw = fwWide > 0 && fwCentral > 0;

  // 미드필더 5명 이상이면 원래 두 줄(수비형/공격형)로 나눠서 "3-6-1" 대신
  // "3-3-3-1"처럼 자연스러운 모양을 만드는 게 목적이었다. 하지만 이건 어디까지나
  // "정렬된 순서를 숫자로만 반 나누는" 추측성 휴리스틱이라, 윙/중앙처럼 실제
  // 포지션 코드로 확인된 분리가 있을 때는 그쪽을 우선한다. 두 분리를 동시에
  // 적용하면 "2-2-3-1-2"처럼 부자연스러운 5구간이 나오므로(실사용 확인됨),
  // splitFw가 참이면 mf는 쪼개지 않고 그대로 한 줄로 낸다. (예: DF2, CM4+CDM1=5,
  // RW1, CF2 → "2-5-1-2")
  if (!splitFw && mf >= 5) {
    const deeperMf = Math.floor(mf / 2);
    const advancedMf = mf - deeperMf;
    segments.push(deeperMf, advancedMf);
  } else if (mf > 0) {
    segments.push(mf);
  }

  // 윙어(측면)와 중앙 공격수가 둘 다 있으면 두 줄로: 측면이 앞줄, 중앙이 맨 앞줄.
  if (splitFw) {
    segments.push(fwWide, fwCentral);
  } else {
    segments.push(fwWide + fwCentral);
  }

  return segments.join('-');
}

// "이름 (POS)|사진url" 형태의 원본 라인업 배열을 받아서
//  1) GK → DF → MF → WIDE(윙) → FW(중앙) 순서로 재정렬하고
//  2) 그 순서에 맞는 포메이션 문자열을 같이 계산해서 반환한다.
// _slug_.astro는 좌표를 "배열 순서" 기준으로 채우므로, 소스(footystats 등)가 준
// 원본 순서가 뒤섞여 있어도(예: LW-CF-CF-RW-LW) 이 함수를 거치면 항상
// "수비-미드-윙-중앙공격" 블록 순서로 정렬된 배열 + 그에 맞는 포메이션 문자열이
// 세트로 나온다. 별도의 사전 정렬 스크립트 없이 렌더링 시점에 바로 계산 가능.
export function sortLineupForPitchView(lineupItems) {
  if (!lineupItems || lineupItems.length === 0) {
    return { sortedItems: [], formation: null };
  }

  const groups = { gk: [], df: [], mf: [], wide: [], central: [], unknown: [] };
  for (const item of lineupItems) {
    const base = item.split('|')[0] || '';
    const posMatch = base.match(/\(([^)]+)\)/);
    const pos = (posMatch ? posMatch[1] : '').toUpperCase().trim();
    if (pos === 'GK') groups.gk.push(item);
    else if (DF_POSITIONS.has(pos)) groups.df.push(item);
    else if (MF_POSITIONS.has(pos)) groups.mf.push(item);
    else if (WIDE_FW_POSITIONS.has(pos)) groups.wide.push(item);
    else if (CENTRAL_FW_POSITIONS.has(pos)) groups.central.push(item);
    else groups.unknown.push(item);
  }

  // 미분류 포지션("-" 등)은 formation 계산과 동일하게 미드필더로 취급해서
  // MF 블록에 합류시킨다 — 배열 길이와 포메이션 숫자 합이 항상 일치해야 하기 때문.
  const mfGroup = [...groups.mf, ...groups.unknown];

  const sortedItems = [...groups.gk, ...groups.df, ...mfGroup, ...groups.wide, ...groups.central];

  const gk = groups.gk.length;
  const df = groups.df.length;
  const mf = mfGroup.length;
  const fwWide = groups.wide.length;
  const fwCentral = groups.central.length;
  const fw = fwWide + fwCentral;

  let formation = null;
  if (gk === 1 && df > 0 && fw > 0 && df + mf + fw >= 9) {
    formation = buildFormationString(df, mf, fwWide, fwCentral);
  }

  return { sortedItems, formation };
}