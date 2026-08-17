// scripts/fotmob-lineup-update.js
// footystats-lineup-update.js를 대체하는 스크립트. 이미 생성된 축구 분석글의
// homeTeam/awayTeam(한글)을 읽어서 fotmob.com(비공식 공개 API)에서 H2H·최근폼·
// 실제(또는 예상) 선발 라인업·결장자를 수집해온다.
//
// footystats와 달리 프록시/쿠키가 전혀 필요 없다 — fotmob은 Cloudflare 챌린지가
// 없는 완전 공개 API라 GitHub Actions IP에서 바로 직접 호출된다(실사용 테스트로
// 확인, 2026-07). 실제 fetch/매칭 로직은 fetch-fotmob-context.js와 공유하기 위해
// fotmob-common.js에 모아뒀다.
//
// 정책:
// - h2h/homeRecent/awayRecent: 기존에 이미 5개 이상 있으면 안 건드림. 부족한 만큼만
//   "날짜순 보충"(기존 항목 유지, 중복 추가 안 함).
// - homeLineup/awayLineup/homeFormation/awayFormation: 비어있을 때만 채움.
// - injuryHome/injuryAway: 비어있거나 "없음"(글 작성 시점에 fotmob 라인업이 아직
//   안 나와서 fetch-fotmob-context.js가 못 채운 경우)일 때만 채움 — 이미 ESPN 등
//   다른 소스로 채워진 값은 덮어쓰지 않는다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveFormationFromLineup } from './formation-common.js';
import {
  matchTeamWithAlias,
  resolveHomeFirst,
  findFotmobMatch,
  fetchMatchDetails,
  formatFotmobLineup,
  extractFotmobCoach,
  toFotmobH2hDisplay,
  toFotmobRecentDisplay,
  getFormOwnerId,
  extractFotmobInjuries,
  POS_LABEL,
} from './fotmob-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../src/content/posts');
const TARGET_COUNT = 5; // h2h/homeRecent/awayRecent를 이 개수까지 채운다

// ─────────────────────────────────────────────
// team_name_map.js(한글⇄영문) 로드
// ─────────────────────────────────────────────
function buildMaps(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const koToEn = {};
  const enToKo = {};
  for (const [, en, ko] of pairs) {
    if (!koToEn[ko]) koToEn[ko] = en;
    enToKo[en] = ko;
  }
  return { koToEn, enToKo };
}
const TEAM_MAP_PATH = path.resolve(__dirname, './team_name_map.js');
const { koToEn: KO_TO_EN } = buildMaps(TEAM_MAP_PATH);

function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

// ⚠️ team_name_map.js는 남녀 국가대표팀(핀란드/스웨덴 등 69개, 실사용 확인 2026-08)이
// 같은 한글값을 공유한다(번역 편의 목적 — espn-common.js hasWomenSuffix 주석 참고).
// 그래서 위 KO_TO_EN 역방향 조회는 한글명만으로는 성별을 복구 못 하고, 파일에 먼저
// 등장한 영문키 하나로 뭉개버린다(예: "핀란드" → 항상 "Finland", 실제로 여자 경기여도
// W가 안 붙음). 이 상태로 findFotmobMatch에 넘기면 근처 날짜에 같은 나라 남자
// 국가대표 경기가 있을 때 그 경기 데이터가 여자팀 글에 잘못 섞여 들어갈 수 있다.
// 글 frontmatter의 league 값(예: "네이션스리그(W)", "국제친선(W)")엔 이미 성별이
// 드러나 있으므로, 이걸 근거로 KO_TO_EN이 놓친 W를 다시 붙이거나(또는 잘못 붙은 W를
// 떼어내서) 이 글과 관련된 모든 팀명 비교에 일관되게 적용한다.
function isWomensLeagueLabel(leagueLabel) {
  return /\(w\)|여자부/i.test(String(leagueLabel || ''));
}
function hasWomenSuffixLocal(str) {
  return /\s+\(?w\)?$/i.test(String(str || '').trim());
}
function toEnglishTeamNameGendered(koOrEnName, isWomens) {
  const base = toEnglishTeamName(koOrEnName);
  const hasW = hasWomenSuffixLocal(base);
  if (isWomens && !hasW) return `${base} W`;
  if (!isWomens && hasW) return String(base).trim().replace(/\s+\(?w\)?$/i, '');
  return base;
}

// ─────────────────────────────────────────────
// frontmatter 읽기/쓰기 (espn-boxscore-update.js / footystats-lineup-update.js와 동일)
// ─────────────────────────────────────────────
function updateMdFrontmatter(filePath, updates) {
  let content  = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) { console.warn(`⚠️ frontmatter 없음: ${filePath}`); return false; }

  let fm = fmMatch[1];
  for (const [key, value] of Object.entries(updates)) {
    const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const regex   = new RegExp(`^${key}:.*$`, 'm');
    if (regex.test(fm)) {
      fm = fm.replace(regex, `${key}: "${escaped}"`);
    } else {
      fm = fm.trimEnd() + `\n${key}: "${escaped}"`;
    }
  }

  const newContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${fm}\n---`);
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

function parseFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match   = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
}

// ⚠️ fetch-all.js가 축구를 D+3까지 미리 당겨와 분석글을 만들어두므로, 실제 경기는
// 파일명 날짜보다 최대 3일 뒤일 수 있다. espn-boxscore-update.js와 동일하게 ±2일
// 범위로 넉넉히 잡는다.
function getKstDates() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const offsets = [-2, -1, 0, 1, 2];
  return offsets.map(n => new Date(now.getTime() + n * 86400000).toISOString().slice(0, 10));
}

function getTargetPostFiles() {
  const targetDates = getKstDates();
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && targetDates.some(d => f.startsWith(d)))
    .map(f => path.join(POSTS_DIR, f));
}

// ─────────────────────────────────────────────
// 기존 h2h/recent 배열 파싱 + 부족분 보충 (footystats-lineup-update.js와 동일 로직)
// ─────────────────────────────────────────────
function getExistingMatches(raw) {
  if (!raw) return { items: [] };
  const stripped = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!stripped || stripped === '[]') return { items: [] };
  if (!stripped.startsWith('[')) return { items: [] };
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return { items: parsed };
  } catch { /* fallthrough */ }
  return { items: null };
}

function parseDisplayDate(d) {
  const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return NaN;
  return new Date(`20${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
}

function isProbablySameMatch(a, b, isWomens = false) {
  const aTime = parseDisplayDate(a.date);
  const bTime = parseDisplayDate(b.date);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return false;
  if (Math.abs(aTime - bTime) > 1 * 24 * 60 * 60 * 1000) return false;

  const scoreA = String(a.score || '').trim();
  const scoreB = String(b.score || '').trim();
  if (!scoreA || !scoreB) return false;
  const sameScoreDirect = scoreA === scoreB;
  const partsA = scoreA.split('-').map(s => s.trim());
  const partsB = scoreB.split('-').map(s => s.trim());
  const sameScoreSwapped = partsA.length === 2 && partsB.length === 2
    && partsA[0] === partsB[1] && partsA[1] === partsB[0];
  if (!sameScoreDirect && !sameScoreSwapped) return false;

  // ⚠️ a(이미 글에 저장된 기존 항목)는 최초 글 생성 시 TEAM_NAME_MAP으로 한글
  // 번역된 상태("아스톤 빌라")일 수 있고, b(이번에 fotmob에서 새로 가져온 항목)는
  // toFotmobH2hDisplay/toFotmobRecentDisplay가 번역 없이 fotmob 원문 그대로
  // ("Aston Villa") 준다. 번역 없이 바로 비교하면 같은 팀을 다른 팀으로 오인해서
  // dedup이 실패하고 같은 경기가 중복으로 쌓이는 사고가 났다(실사용 확인, 2026-08).
  // 비교 전에 양쪽 다 영문으로 정규화해서 언어가 섞여도 같은 경기로 인식되게 한다.
  // isWomens는 이 글(post) 전체의 성별 맥락(fm.league 기준) — a는 한글이라 KO_TO_EN
  // 역변환 중 성별 정보가 소실될 수 있어(예: "핀란드"→"Finland", W 소실) 반드시
  // 다시 강제로 맞춰준다. matchTeam()의 성별 가드가 이 단계 이후에 작동하므로,
  // 여기서 잘못된 성별인 채로 넘기면 가드를 무력화하고 남녀 경기가 섞일 수 있다.
  // ⚠️ b(fotmob 원문 영문)는 절대 강제 보정하면 안 된다 — 이미 올바르게 매칭된
  // candidate에서 나온 진짜 성별 그대로다. 여기에도 isWomens를 강제로 씌우면
  // 오히려 진짜 남자팀 경기("Finland")를 여자부처럼("Finland W") 둔갑시켜서
  // 원래는 서로 다른 경기인데 같은 경기로 오인하게 되는 새 버그가 생긴다
  // (실제로 이 테스트를 돌려보다가 발견해서 여기만 plain toEnglishTeamName으로 되돌림).
  const aHome = toEnglishTeamNameGendered(a.home, isWomens);
  const aAway = toEnglishTeamNameGendered(a.away, isWomens);
  const bHome = toEnglishTeamName(b.home);
  const bAway = toEnglishTeamName(b.away);

  const homeMatches = matchTeamWithAlias(aHome, bHome) || matchTeamWithAlias(aHome, bAway);
  const awayMatches = matchTeamWithAlias(aAway, bHome) || matchTeamWithAlias(aAway, bAway);
  return homeMatches || awayMatches;
}

function supplementMatchList(existingItems, additionalItems, targetCount, isWomens = false) {
  const need = targetCount - existingItems.length;
  if (need <= 0) return null;
  // 🛡️ 안전장치: additionalItems는 정상적으로는 이미 성별이 올바르게 매칭된 candidate의
  // h2h/teamForm이라 섞일 일이 없어야 하지만, 혹시라도(예: findFotmobMatch가 잘못된
  // candidate를 골랐거나 fotmob 쪽 데이터 자체가 섞여 오는 경우) 대비해서 이 글의
  // 성별 맥락(isWomens)과 다른 항목은 애초에 후보에서 제외한다 — dedup 로직(위
  // isProbablySameMatch)이 놓치더라도 여기서 한 번 더 막는다.
  const genderOk = m => hasWomenSuffixLocal(m.home) === isWomens && hasWomenSuffixLocal(m.away) === isWomens;
  const candidates = additionalItems.filter(genderOk).filter(m =>
    !existingItems.some(e => isProbablySameMatch(e, m, isWomens))
  );
  candidates.sort((a, b) => (a.date < b.date ? 1 : -1));
  const toAdd = candidates.slice(0, need);
  if (toAdd.length === 0) return null;
  const merged = [...existingItems, ...toAdd];
  merged.sort((a, b) => (a.date < b.date ? 1 : -1));
  return merged;
}

function isEmptyField(raw) {
  if (!raw) return true;
  return raw.trim().replace(/^['"]|['"]$/g, '').trim() === '';
}

// 감독 필드는 "이름만 저장된 상태"(fotmob이 coach.id를 아직 안 줘서 사진을 못 만들었던
// 시점에 저장됨)일 수 있다. 이 경우 isEmptyField()로는 "이미 채워짐"으로 보여서
// 영원히 재조회 안 되므로, "|"(이름|사진URL) 구분자가 없는 경우를 별도로 잡아낸다.
function coachNeedsPhoto(raw) {
  if (isEmptyField(raw)) return true;
  const stripped = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  return !stripped.includes('|');
}

// fotmob의 unavailable[] → {name, status, detail} 배열을 사람이 읽는 텍스트로 변환.
// analyze-router-one-git.js의 formatInjuries()와 같은 표기 스타일을 맞춘다.
// i.status는 extractFotmobInjuries()가 injuryId 매핑표로 알아낸 구체적 부상명
// (예: "무릎 부상")이거나, 매핑을 모르면 "부상"으로 뭉뚱그린 값이다.
function formatFotmobInjuryText(list) {
  if (!list || list.length === 0) return null;
  return list
    .map(i => `${i.name}[주요](${i.status}${i.detail ? ' - 복귀예정 ' + i.detail : ''})`)
    .join(' | ');
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  console.log('🌍 fotmob 업데이트 시작\n');

  const args = process.argv.slice(2);
  const postFiles = args.length > 0
    ? args.filter(f => f.endsWith('.md') && fs.existsSync(f))
    : getTargetPostFiles();

  if (postFiles.length === 0) {
    console.log('✅ 업데이트할 파일 없음');
    return;
  }

  console.log(`🎯 대상 파일: ${postFiles.length}건`);

  let updatedCount = 0;
  let skipCount = 0;
  const unmatchedLog = [];

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);
    const category = (fm.category || '').toLowerCase();
    if (category !== 'soccer') { skipCount++; continue; }

    const existingH2h        = getExistingMatches(fm.h2h);
    const existingHomeRecent = getExistingMatches(fm.homeRecent);
    const existingAwayRecent = getExistingMatches(fm.awayRecent);
    const homeLineupEmpty    = isEmptyField(fm.homeLineup);
    const awayLineupEmpty    = isEmptyField(fm.awayLineup);
    const homeFormationEmpty = isEmptyField(fm.homeFormation);
    const awayFormationEmpty = isEmptyField(fm.awayFormation);
    const homeCoachEmpty     = isEmptyField(fm.homeCoach);
    const awayCoachEmpty     = isEmptyField(fm.awayCoach);
    // "이름만 있고 사진 없음" 상태도 재확인 대상 — coach.id가 뒤늦게 채워지면 사진을 붙여준다.
    const homeCoachNeedsPhoto = coachNeedsPhoto(fm.homeCoach);
    const awayCoachNeedsPhoto = coachNeedsPhoto(fm.awayCoach);

    const needH2h        = existingH2h.items !== null && existingH2h.items.length < TARGET_COUNT;
    const needHomeRecent = existingHomeRecent.items !== null && existingHomeRecent.items.length < TARGET_COUNT;
    const needAwayRecent = existingAwayRecent.items !== null && existingAwayRecent.items.length < TARGET_COUNT;
    // 감독은 라인업과 같은 시점(content.lineup)에 나오는 정보라 needLineup에 합류시킨다
    const needLineup = homeLineupEmpty || awayLineupEmpty || homeFormationEmpty || awayFormationEmpty
      || homeCoachNeedsPhoto || awayCoachNeedsPhoto;
    // ⚠️ 부상자는 라인업과 달리 "한 번 확정되면 안 바뀌는 정보"가 아니라 경기 직전까지
    // 계속 바뀐다(회복/신규 부상 등). 그래서 라인업처럼 "비어있을 때만 채움"이 아니라
    // fotmob 데이터가 있을 때마다 항상 최신 상태로 덮어써야 한다(2026-07 실사용 버그로
    // 확인 — 예전에 채워진 결장자 이름이 회복 후에도 영원히 안 바뀌는 문제가 있었음).
    const needInjury = true;

    if (!needH2h && !needHomeRecent && !needAwayRecent && !needLineup && !needInjury) { skipCount++; continue; }

    // league-name-map.js가 여자부 리그를 "네이션스리그(W)"/"국제친선(W)"처럼 "(W)"로,
    // 그 외엔 공통 토큰 치환으로 "...여자부"로 번역해서 저장한다 — 이 라벨을 근거로
    // KO_TO_EN 역변환에서 소실될 수 있는 성별 정보를 다시 강제해준다(위 주석 참고).
    const isWomens = isWomensLeagueLabel(fm.league);
    const homeTeamEn = toEnglishTeamNameGendered(fm.homeTeam || '', isWomens);
    const awayTeamEn = toEnglishTeamNameGendered(fm.awayTeam || '', isWomens);

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);
    console.log(`   필요: h2h(${existingH2h.items?.length ?? '파싱불가'}→${needH2h}) homeRecent(${existingHomeRecent.items?.length ?? '파싱불가'}→${needHomeRecent}) awayRecent(${existingAwayRecent.items?.length ?? '파싱불가'}→${needAwayRecent}) lineup(${needLineup}) injury(${needInjury})`);

    try {
      const candidate = await findFotmobMatch(fm.date, homeTeamEn, awayTeamEn);
      if (!candidate) {
        console.log(`   ⚠️ fotmob에서 경기 매칭 실패`);
        unmatchedLog.push({ file: path.basename(filePath), date: fm.date, home: homeTeamEn, away: awayTeamEn });
        skipCount++;
        continue;
      }
      console.log(`   ✅ 매칭: ${candidate.home} vs ${candidate.away} (matchId ${candidate.id}, ${candidate.leagueName})`);

      const details = await fetchMatchDetails(candidate.id);
      if (!details) { skipCount++; continue; }

      const updates = {};

      // fotmob의 general.homeTeam/awayTeam 순서가 우리 DB 기준 홈/원정과 같은지 확인
      // (반대로 올 수 있어서 반드시 한 번 더 대조 후 좌우를 맞춰야 함. home↔home
      // 한 방향만 보면 표기가 다른 팀(예: "PSG" vs "Paris Saint-Germain")에서
      // 실패해 결장자/라인업/최근폼이 통째로 뒤바뀌는 사고가 났다 — fotmob-common.js
      // resolveHomeFirst() 주석 참고. 판별 불가면 이 파일은 건너뛴다.)
      const isHomeFirst = resolveHomeFirst(
        details.general?.homeTeam?.name || '',
        details.general?.awayTeam?.name || '',
        homeTeamEn,
        awayTeamEn
      );
      if (isHomeFirst === null) {
        console.log(`   ⚠️ 홈/원정 판별 불가 (fotmob: ${details.general?.homeTeam?.name || '?'} vs ${details.general?.awayTeam?.name || '?'}) — 스킵`);
        skipCount++;
        continue;
      }

      const lineup = details.content?.lineup;
      const fotmobHomeLineup = isHomeFirst ? lineup?.homeTeam : lineup?.awayTeam;
      const fotmobAwayLineup = isHomeFirst ? lineup?.awayTeam : lineup?.homeTeam;

      if (needLineup && lineup) {
        if (homeLineupEmpty) {
          const items = formatFotmobLineup(fotmobHomeLineup);
          if (items.length > 0) updates.homeLineup = JSON.stringify(items);
        }
        if (awayLineupEmpty) {
          const items = formatFotmobLineup(fotmobAwayLineup);
          if (items.length > 0) updates.awayLineup = JSON.stringify(items);
        }

        if (homeCoachEmpty) {
          // 아예 없던 상태 — 사진이 아직 없어도(이름만이라도) 우선 저장
          const coach = extractFotmobCoach(fotmobHomeLineup);
          if (coach) updates.homeCoach = coach;
        } else if (homeCoachNeedsPhoto) {
          // 이름만 저장된 상태 — 사진(coach.id)이 이번에 확보됐을 때만 업그레이드
          const coach = extractFotmobCoach(fotmobHomeLineup);
          if (coach && coach.includes('|')) updates.homeCoach = coach;
        }
        if (awayCoachEmpty) {
          const coach = extractFotmobCoach(fotmobAwayLineup);
          if (coach) updates.awayCoach = coach;
        } else if (awayCoachNeedsPhoto) {
          const coach = extractFotmobCoach(fotmobAwayLineup);
          if (coach && coach.includes('|')) updates.awayCoach = coach;
        }

        if (homeFormationEmpty) {
          if (fotmobHomeLineup?.formation) {
            updates.homeFormation = fotmobHomeLineup.formation;
          } else if (fotmobHomeLineup?.starters?.length) {
            const positions = fotmobHomeLineup.starters.map(p => ({ position: POS_LABEL[p.usualPlayingPositionId] || '' }));
            const derived = deriveFormationFromLineup(positions);
            if (derived) updates.homeFormation = derived;
          }
        }
        if (awayFormationEmpty) {
          if (fotmobAwayLineup?.formation) {
            updates.awayFormation = fotmobAwayLineup.formation;
          } else if (fotmobAwayLineup?.starters?.length) {
            const positions = fotmobAwayLineup.starters.map(p => ({ position: POS_LABEL[p.usualPlayingPositionId] || '' }));
            const derived = deriveFormationFromLineup(positions);
            if (derived) updates.awayFormation = derived;
          }
        }
      }

      if (needInjury && lineup) {
        // ⚠️ lineup !== null이면 fotmob이 이 경기의 결장자 명단을 "확정" 상태로 갖고
        // 있다는 뜻이라, 결장자가 0명이어도(= 다 회복함) 그 정보 자체가 유효하다.
        // lineup이 null이면(경기가 아직 멀어서 정보 자체가 없음) 아래 if(lineup)에서
        // 걸러지므로 이 블록엔 아예 안 들어오고, 기존 값을 그대로 보존한다.
        const rawInjuries = extractFotmobInjuries(lineup);
        const injuries = isHomeFirst
          ? rawInjuries
          : { home: rawInjuries.away, away: rawInjuries.home };

        const homeText = formatFotmobInjuryText(injuries.home) || '없음';
        const awayText = formatFotmobInjuryText(injuries.away) || '없음';

        // 실제로 값이 달라졌을 때만 write해서 불필요한 git diff/커밋을 방지
        if (homeText !== (fm.injuryHome || '').trim()) updates.injuryHome = homeText;
        if (awayText !== (fm.injuryAway || '').trim()) updates.injuryAway = awayText;
      }

      if (needH2h) {
        const items = toFotmobH2hDisplay(details.content?.h2h, fm.date);
        const merged = supplementMatchList(existingH2h.items, items, TARGET_COUNT, isWomens);
        if (merged) updates.h2h = JSON.stringify(merged);
      }

      if (needHomeRecent || needAwayRecent) {
        const teamForm = details.content?.matchFacts?.teamForm || [];
        const generalHomeId = String(details.general?.homeTeam?.id ?? '');
        const generalAwayId = String(details.general?.awayTeam?.id ?? '');
        const ourHomeId = isHomeFirst ? generalHomeId : generalAwayId;
        const ourAwayId = isHomeFirst ? generalAwayId : generalHomeId;

        let ourHomeFormArr = [];
        let ourAwayFormArr = [];
        for (const arr of teamForm) {
          const ownerId = getFormOwnerId(arr);
          if (ownerId === ourHomeId) ourHomeFormArr = arr;
          else if (ownerId === ourAwayId) ourAwayFormArr = arr;
        }

        ourHomeFormArr = ourHomeFormArr.filter(item =>
        matchTeamWithAlias(item.home?.name || '', homeTeamEn) || matchTeamWithAlias(item.away?.name || '', homeTeamEn)
        );
        ourAwayFormArr = ourAwayFormArr.filter(item =>
        matchTeamWithAlias(item.home?.name || '', awayTeamEn) || matchTeamWithAlias(item.away?.name || '', awayTeamEn)
        );

        if (needHomeRecent) {
          const items = toFotmobRecentDisplay(ourHomeFormArr, fm.date);
          const merged = supplementMatchList(existingHomeRecent.items, items, TARGET_COUNT, isWomens);
          if (merged) updates.homeRecent = JSON.stringify(merged);
        }
        if (needAwayRecent) {
          const items = toFotmobRecentDisplay(ourAwayFormArr, fm.date);
          const merged = supplementMatchList(existingAwayRecent.items, items, TARGET_COUNT, isWomens);
          if (merged) updates.awayRecent = JSON.stringify(merged);
        }
      }

      if (Object.keys(updates).length > 0) {
        const ok = updateMdFrontmatter(filePath, updates);
        if (ok) {
          console.log(`   🔄 업데이트 완료 | ${Object.keys(updates).join(', ')}`);
          updatedCount++;
        }
      } else {
        console.log(`   ℹ️ 채울 것 없음 (fotmob에도 보충할 데이터가 없었음)`);
        skipCount++;
      }
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  if (unmatchedLog.length > 0) {
    const logPath = path.resolve(__dirname, 'fotmob-unmatched-log.json');
    fs.writeFileSync(logPath, JSON.stringify(unmatchedLog, null, 2), 'utf-8');
    console.log(`\n📝 매칭 실패 ${unmatchedLog.length}건 → ${path.basename(logPath)} 에 기록 (별칭 등록 참고용)`);
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main().catch(err => {
  console.error('❌ [fotmob 업데이트] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});