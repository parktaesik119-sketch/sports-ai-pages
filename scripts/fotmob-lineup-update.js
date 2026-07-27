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
  findFotmobMatch,
  fetchMatchDetails,
  formatFotmobLineup,
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

function isProbablySameMatch(a, b) {
  const aTime = parseDisplayDate(a.date);
  const bTime = parseDisplayDate(b.date);
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return false;

  const scoreA = String(a.score || '').trim();
  const scoreB = String(b.score || '').trim();
  if (!scoreA || !scoreB) return false;
  const sameScoreDirect = scoreA === scoreB;
  const partsA = scoreA.split('-').map(s => s.trim());
  const partsB = scoreB.split('-').map(s => s.trim());
  const sameScoreSwapped = partsA.length === 2 && partsB.length === 2
    && partsA[0] === partsB[1] && partsA[1] === partsB[0];
  if (!sameScoreDirect && !sameScoreSwapped) return false;

  // 날짜 문자열이 완전히 같고 스코어까지 일치하면, 팀명이 한글/영문처럼 언어가
  // 달라 matchTeam이 못 알아보더라도 같은 경기로 간주한다 — 같은 날 같은 스코어의
  // 다른 경기가 우연히 겹칠 확률은 사실상 없다 (한글/영문 중복 등록 버그로 확인, 2026-07).
  if (a.date === b.date) return true;

  if (Math.abs(aTime - bTime) > 1 * 24 * 60 * 60 * 1000) return false;

  const homeMatches = matchTeamWithAlias(a.home, b.home) || matchTeamWithAlias(a.home, b.away);
  const awayMatches = matchTeamWithAlias(a.away, b.home) || matchTeamWithAlias(a.away, b.away);
  return homeMatches || awayMatches;
}

function supplementMatchList(existingItems, additionalItems, targetCount) {
  const need = targetCount - existingItems.length;
  if (need <= 0) return null;
  const candidates = additionalItems.filter(m =>
    !existingItems.some(e => isProbablySameMatch(e, m))
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

// injuryHome/injuryAway는 "없음"이 글 생성 시점 기본값이라, 비어있는 것과 동일하게
// 취급해서 채워도 되는 대상으로 판단한다. 이미 ESPN 등으로 실제 값이 채워져
// 있으면(= "없음"도 빈 문자열도 아니면) 손대지 않는다.
function isEmptyOrNoneField(raw) {
  if (isEmptyField(raw)) return true;
  return raw.trim().replace(/^['"]|['"]$/g, '').trim() === '없음';
}

// fotmob의 unavailable[] → {name, status, detail} 배열을 사람이 읽는 텍스트로 변환.
// analyze-router-one-git.js의 formatInjuries()와 같은 표기 스타일을 맞춘다
// (다만 fotmob은 세부 중증도 구분을 안 줘서 전부 [주요]로 표기).
function formatFotmobInjuryText(list) {
  if (!list || list.length === 0) return null;
  return list
    .map(i => `${i.name}[주요](부상${i.detail ? ' - 복귀예정 ' + i.detail : ''})`)
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
    const homeInjuryEmpty    = isEmptyOrNoneField(fm.injuryHome);
    const awayInjuryEmpty    = isEmptyOrNoneField(fm.injuryAway);

    const needH2h        = existingH2h.items !== null && existingH2h.items.length < TARGET_COUNT;
    const needHomeRecent = existingHomeRecent.items !== null && existingHomeRecent.items.length < TARGET_COUNT;
    const needAwayRecent = existingAwayRecent.items !== null && existingAwayRecent.items.length < TARGET_COUNT;
    const needLineup = homeLineupEmpty || awayLineupEmpty || homeFormationEmpty || awayFormationEmpty;
    const needInjury  = homeInjuryEmpty || awayInjuryEmpty;

    if (!needH2h && !needHomeRecent && !needAwayRecent && !needLineup && !needInjury) { skipCount++; continue; }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

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
      // (반대로 올 수 있어서 반드시 한 번 더 대조 후 좌우를 맞춰야 함)
      const isHomeFirst = matchTeamWithAlias(details.general?.homeTeam?.name || '', homeTeamEn);

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
        const rawInjuries = extractFotmobInjuries(lineup);
        const injuries = isHomeFirst
          ? rawInjuries
          : { home: rawInjuries.away, away: rawInjuries.home };

        if (homeInjuryEmpty) {
          const text = formatFotmobInjuryText(injuries.home);
          if (text) updates.injuryHome = text;
        }
        if (awayInjuryEmpty) {
          const text = formatFotmobInjuryText(injuries.away);
          if (text) updates.injuryAway = text;
        }
      }

      if (needH2h) {
        const items = toFotmobH2hDisplay(details.content?.h2h, fm.date);
        const merged = supplementMatchList(existingH2h.items, items, TARGET_COUNT);
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

        if (needHomeRecent) {
          const items = toFotmobRecentDisplay(ourHomeFormArr, fm.date);
          const merged = supplementMatchList(existingHomeRecent.items, items, TARGET_COUNT);
          if (merged) updates.homeRecent = JSON.stringify(merged);
        }
        if (needAwayRecent) {
          const items = toFotmobRecentDisplay(ourAwayFormArr, fm.date);
          const merged = supplementMatchList(existingAwayRecent.items, items, TARGET_COUNT);
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
