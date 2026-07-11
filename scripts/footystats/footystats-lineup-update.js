// scripts/footystats/footystats-lineup-update.js
// kbo-lineup-update.js / uefa-lineup-update.js와 같은 패턴 — 이미 생성된 축구 분석글의
// homeTeam/awayTeam(한글)을 읽어서 footystats.org에서 H2H·최근폼·실제 선발 라인업을
// 수집해온다. api-sports를 전혀 호출하지 않으므로 무료 호출 한도(100회/일)와 무관하다.
//
// ⚠️ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수 필요 (집 PC 프록시 경유 필수).
//
// 정책:
// - h2h/homeRecent/awayRecent: 기존에 이미 5개 이상 있으면 안 건드림. 5개 미만이면
//   부족한 만큼만 footystats 데이터로 "날짜순 보충"(기존 항목은 그대로 유지, 겹치는
//   경기는 중복 추가 안 함). 기존 데이터(한글명+사이트 내부링크)가 footystats보다
//   품질이 좋으므로 절대 덮어쓰지 않는다.
// - homeLineup/awayLineup: 이미 값이 있으면(ESPN/UEFA가 이미 채웠으면) 안 건드리고,
//   비어있을 때만 footystats의 "최근 사용 라인업"으로 채운다.
//   ⚠️ footystats 문구상 이번 경기 확정 라인업이 아니라 "가장 최근에 쓰인 라인업"
//   기준 예측이다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchTeam } from '../espn-common.js';
import {
  searchClub,
  getClubPage,
  parseClubRecentMatches,
  parseCountrySlug,
  extractTeamSlugFromClubPath,
  getH2hPage,
  parseH2hMatches,
  parseMatchLineups,
  formatLineupForDisplay,
  toH2hDisplayFormat,
  toRecentDisplayFormat,
} from './footystats-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../../src/content/posts');
const TARGET_COUNT = 5; // h2h/homeRecent/awayRecent를 이 개수까지 채운다

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
const TEAM_MAP_PATH = path.resolve(__dirname, '../team_name_map.js');
const { koToEn: KO_TO_EN, enToKo: EN_TO_KO } = buildMaps(TEAM_MAP_PATH);
const ALL_MAPPED_EN_NAMES = Object.keys(EN_TO_KO);

function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

function translateTeamNameToKorean(footystatsName) {
  if (!footystatsName) return footystatsName;
  if (EN_TO_KO[footystatsName]) return EN_TO_KO[footystatsName];
  const matched = ALL_MAPPED_EN_NAMES.find(en => matchTeam(footystatsName, en));
  return matched ? EN_TO_KO[matched] : footystatsName;
}

function translateMatchList(matches) {
  return matches.map(m => ({
    ...m,
    home: translateTeamNameToKorean(m.home),
    away: translateTeamNameToKorean(m.away),
  }));
}

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

function getKstDates() {
  const now       = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today     = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow  = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  return [today, yesterday, tomorrow];
}

function getTargetPostFiles() {
  const targetDates = getKstDates();
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md') && targetDates.some(d => f.startsWith(d)))
    .map(f => path.join(POSTS_DIR, f));
}

async function findClub(teamNameEn) {
  const results = await searchClub(teamNameEn);
  for (const r of results) {
    if (matchTeam(r.name, teamNameEn)) return r;
  }
  return results[0] || null;
}

async function collectTeamData(teamNameEn) {
  const club = await findClub(teamNameEn);
  if (!club) return null;

  const $ = await getClubPage(club.path);
  return {
    matchedName: club.name,
    clubPath: club.path,
    teamSlug: extractTeamSlugFromClubPath(club.path),
    countrySlug: parseCountrySlug($),
    recentMatches: parseClubRecentMatches($),
  };
}

function getExistingMatches(raw) {
  if (!raw) return { items: [] };
  const stripped = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!stripped || stripped === '[]') return { items: [] };
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return { items: parsed };
  } catch { /* fallthrough */ }
  return { items: null };
}

function supplementMatchList(existingItems, additionalItems, targetCount) {
  const need = targetCount - existingItems.length;
  if (need <= 0) return null;

  const existingKeys = new Set(existingItems.map(m => `${m.date}|${m.home}|${m.away}`));
  const candidates = additionalItems.filter(m => !existingKeys.has(`${m.date}|${m.home}|${m.away}`));
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

async function main() {
  console.log('⚽ footystats 업데이트 시작\n');

  if (!process.env.HOME_PROXY_URL || !process.env.HOME_PROXY_SECRET) {
    console.log('⚠️ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수 없음 — footystats 업데이트를 건너뜁니다.');
    return;
  }

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
  let skipCount    = 0;

  for (const filePath of postFiles) {
    const fm = parseFrontmatter(filePath);

    const category = (fm.category || '').toLowerCase();
    if (category !== 'soccer') {
      skipCount++;
      continue;
    }

    const existingH2h        = getExistingMatches(fm.h2h);
    const existingHomeRecent = getExistingMatches(fm.homeRecent);
    const existingAwayRecent = getExistingMatches(fm.awayRecent);
    const homeLineupEmpty = isEmptyField(fm.homeLineup);
    const awayLineupEmpty = isEmptyField(fm.awayLineup);

    const needH2h        = existingH2h.items !== null && existingH2h.items.length < TARGET_COUNT;
    const needHomeRecent = existingHomeRecent.items !== null && existingHomeRecent.items.length < TARGET_COUNT;
    const needAwayRecent = existingAwayRecent.items !== null && existingAwayRecent.items.length < TARGET_COUNT;
    const needLineup     = homeLineupEmpty || awayLineupEmpty;

    if (!needH2h && !needHomeRecent && !needAwayRecent && !needLineup) {
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);
    console.log(`   필요: h2h(${existingH2h.items?.length ?? '파싱불가'}→${needH2h}) homeRecent(${existingHomeRecent.items?.length ?? '파싱불가'}→${needHomeRecent}) awayRecent(${existingAwayRecent.items?.length ?? '파싱불가'}→${needAwayRecent}) lineup(${needLineup})`);

    try {
      const homeData = await collectTeamData(homeTeamEn);
      if (!homeData) {
        console.log(`   ⚠️ 홈팀 검색 실패: ${homeTeamEn}`);
        skipCount++;
        continue;
      }
      console.log(`   ✅ 홈팀 매칭: ${homeData.matchedName} (${homeData.clubPath})`);

      const awayData = await collectTeamData(awayTeamEn);
      if (!awayData) {
        console.log(`   ⚠️ 원정팀 검색 실패: ${awayTeamEn}`);
        skipCount++;
        continue;
      }
      console.log(`   ✅ 원정팀 매칭: ${awayData.matchedName} (${awayData.clubPath})`);

      const updates = {};

      if ((needH2h || needLineup) && homeData.countrySlug && homeData.teamSlug && awayData.teamSlug) {
        const $h2h = await getH2hPage(homeData.countrySlug, homeData.teamSlug, awayData.teamSlug).catch(err => {
          console.error(`   ⚠️ H2H 페이지 수집 실패:`, err.message);
          return null;
        });

        if ($h2h) {
          if (needH2h) {
            const h2hRaw = parseH2hMatches($h2h);
            const h2hDisplay = toH2hDisplayFormat(translateMatchList(h2hRaw));
            const merged = supplementMatchList(existingH2h.items, h2hDisplay, TARGET_COUNT);
            if (merged) updates.h2h = JSON.stringify(merged);
          }

          if (needLineup) {
            const lineups = parseMatchLineups($h2h);
            if (lineups) {
              if (homeLineupEmpty && lineups.home.length > 0) {
                updates.homeLineup = JSON.stringify(formatLineupForDisplay(lineups.home));
              }
              if (awayLineupEmpty && lineups.away.length > 0) {
                updates.awayLineup = JSON.stringify(formatLineupForDisplay(lineups.away));
              }
            } else {
              console.log(`   ℹ️ 라인업 섹션 없음 (하위 리그 등 footystats 미지원일 수 있음)`);
            }
          }
        }
      }

      if (needHomeRecent) {
        const homeRecentDisplay = toRecentDisplayFormat(translateMatchList(homeData.recentMatches), fm.homeTeam);
        const merged = supplementMatchList(existingHomeRecent.items, homeRecentDisplay, TARGET_COUNT);
        if (merged) updates.homeRecent = JSON.stringify(merged);
      }
      if (needAwayRecent) {
        const awayRecentDisplay = toRecentDisplayFormat(translateMatchList(awayData.recentMatches), fm.awayTeam);
        const merged = supplementMatchList(existingAwayRecent.items, awayRecentDisplay, TARGET_COUNT);
        if (merged) updates.awayRecent = JSON.stringify(merged);
      }

      if (Object.keys(updates).length > 0) {
        const ok = updateMdFrontmatter(filePath, updates);
        if (ok) {
          console.log(`   🔄 업데이트 완료 | ${Object.keys(updates).join(', ')}`);
          updatedCount++;
        }
      } else {
        console.log(`   ℹ️ 채울 것 없음 (footystats에도 보충할 데이터가 없었음)`);
        skipCount++;
      }
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main().catch(err => {
  console.error('❌ [footystats 업데이트] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});