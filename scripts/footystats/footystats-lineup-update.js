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
  strictTeamMatch,
  parseUpcomingFixtureDate,
  isDateReasonablyClose,
  deriveFormationFromLineup,
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

// ─────────────────────────────────────────────
// footystats 전용 팀 캐시 — 한 번 찾은 팀(영문명 → 클럽 경로)을 저장해뒀다가
// 다음부터는 검색(search.php, 종종 불안정함) 없이 바로 써먹는다.
// 30분마다 도는 스크립트라 시간이 지나면 team_name_map.js처럼 자연스럽게 쌓인다.
// (실제로 파일을 갱신했으면 main()이 끝날 때 커밋되도록 lineup-update.yml에서
// 이 파일도 git add 대상에 포함시켜야 한다)
// ─────────────────────────────────────────────
const TEAM_CACHE_PATH = path.resolve(__dirname, 'team-map-cache.json');

function loadTeamCache() {
  try {
    return JSON.parse(fs.readFileSync(TEAM_CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveTeamCache(cache) {
  fs.writeFileSync(TEAM_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

const teamCache = loadTeamCache();
let teamCacheDirty = false;

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
  if (teamCache[teamNameEn]) {
    return teamCache[teamNameEn];
  }

  const results = await searchClub(teamNameEn);
  for (const r of results) {
    if (strictTeamMatch(r.name, teamNameEn)) {
      teamCache[teamNameEn] = r;
      teamCacheDirty = true;
      return r;
    }
  }
  // ⚠️ 예전엔 매칭 실패 시 results[0]으로 폴백했는데, 이게 "England"가
  // "New England Revolution"으로 잘못 매칭되는 등 엉뚱한 팀을 가져오는 원인이었다.
  // 정확히 매칭되는 게 없으면 그냥 실패로 처리한다(느슨하게 아무거나 가져오지 않음).
  return null;
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

// 사진 URL이 실제로 살아있는지 HEAD 요청으로 확인. ESPN은 사진이 없는 선수 ID에
// 대해 회색 대체 이미지가 아니라 진짜 HTTP 404를 준다(ESPN 비공식 API 문서로 확인,
// 2026-07) — 그래서 상태코드만 봐도 확실하게 판단할 수 있다.
async function hasValidPhoto(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false; // 요청 자체가 실패해도 사진 없는 것으로 간주(보수적으로)
  }
}

// ⚠️ ESPN이 하부리그(예: 우루과이 프리메라디비전) 라인업을 줄 때, 포지션 정보 자체가
// 부실해서 전체 선수가 전부 "SUB"로만 채워지는 경우가 실사용에서 확인됨(코드 버그가
// 아니라 ESPN API 자체가 이 정도 정보만 준 것). 이런 경우 필드 자체는 "비어있지 않지만"
// 사실상 쓸모없는 데이터이므로, footystats가 더 나은 데이터를 갖고 있을 때 이걸 그냥
// 비어있는 것처럼 취급해서 덮어쓸 수 있게 한다.
//
// 포지션은 멀쩡해 보여도 사진이 대부분 깨져있는 경우도 저품질로 본다. 선수 전원을
// 매번 검사하면 요청이 너무 많아지니, 최대 5명만 샘플로 찍어서 절반 넘게 깨져있으면
// (해당 리그 자체의 데이터가 부실하다는 신호로 보고) 저품질로 판정한다.
async function isLowQualityLineup(raw) {
  if (isEmptyField(raw)) return true;
  try {
    const stripped = raw.trim().replace(/^['"]|['"]$/g, '');
    const items = JSON.parse(stripped);
    if (!Array.isArray(items) || items.length === 0) return true;

    // 1) 포지션이 전부 SUB(또는 빈값)면 저품질
    const allSubPosition = items.every(item => {
      const posMatch = String(item).match(/\(([^)]+)\)/);
      const pos = posMatch ? posMatch[1].trim().toUpperCase() : '';
      return pos === 'SUB' || pos === '';
    });
    if (allSubPosition) return true;

    // 2) 사진 샘플(최대 5장)이 절반 넘게 깨져있으면 저품질
    const photoUrls = items.map(item => {
      const parts = String(item).split('|');
      return parts.length > 1 ? parts[parts.length - 1] : '';
    }).filter(Boolean);
    if (photoUrls.length === 0) return false; // 애초에 사진 필드가 없는 포맷이면 판단 보류

    const sample = photoUrls.slice(0, 5);
    const results = await Promise.all(sample.map(hasValidPhoto));
    const validRatio = results.filter(Boolean).length / results.length;
    return validRatio < 0.5;
  } catch {
    return false; // 파싱이 안 되면 뭔가 유효한 데이터가 있는 걸로 보고 보수적으로 안 건드림
  }
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
    const homeLineupEmpty = await isLowQualityLineup(fm.homeLineup);
    const awayLineupEmpty = await isLowQualityLineup(fm.awayLineup);
    const homeFormationEmpty = isEmptyField(fm.homeFormation);
    const awayFormationEmpty = isEmptyField(fm.awayFormation);

    const needH2h        = existingH2h.items !== null && existingH2h.items.length < TARGET_COUNT;
    const needHomeRecent = existingHomeRecent.items !== null && existingHomeRecent.items.length < TARGET_COUNT;
    const needAwayRecent = existingAwayRecent.items !== null && existingAwayRecent.items.length < TARGET_COUNT;
    // 라인업 텍스트뿐 아니라 포메이션 문자열도 비어있으면 H2H 페이지를 가져오는
    // 트리거에 포함시킨다(라인업은 이미 있는데 포메이션만 비어있는 경우도 커버).
    const needLineup = homeLineupEmpty || awayLineupEmpty || homeFormationEmpty || awayFormationEmpty;

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
          const fixtureDate = parseUpcomingFixtureDate($h2h);
          const dateOk = isDateReasonablyClose(fixtureDate, fm.date);

          if (!dateOk) {
            // ⚠️ 팀명은 매칭됐지만(strictTeamMatch 통과), footystats가 알고 있는
            // "다음 경기" 일시가 분석글의 실제 경기 일시와 안 맞는다 = 동명이인 팀
            // (예: 우루과이 Nacional vs 포르투갈 Nacional)으로 잘못 짝지어졌을 가능성이
            // 높다는 뜻. 이럴 땐 데이터를 아예 쓰지 않는다(틀린 데이터보다 안 쓰는 게 낫다).
            console.log(`   ⚠️ 날짜 불일치 감지 — footystats 다음경기: ${fixtureDate || '없음'} / 분석글 경기일시: ${fm.date} → 팀이 잘못 매칭됐을 가능성이 높아 이 데이터는 사용하지 않습니다.`);
          } else {
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

                // footystats는 "4-2-3-1" 같은 포메이션 문자열을 직접 안 주므로,
                // 선발 11명의 세부 포지션 코드를 세어서 유추한다. 불완전하거나
                // 애매하면(deriveFormationFromLineup이 null 반환) 억지로 채우지 않는다.
                if (homeFormationEmpty) {
                  const homeFormation = deriveFormationFromLineup(lineups.home);
                  if (homeFormation) updates.homeFormation = homeFormation;
                }
                if (awayFormationEmpty) {
                  const awayFormation = deriveFormationFromLineup(lineups.away);
                  if (awayFormation) updates.awayFormation = awayFormation;
                }
              } else {
                console.log(`   ℹ️ 라인업 섹션 없음 (하위 리그 등 footystats 미지원일 수 있음)`);
              }
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

  if (teamCacheDirty) {
    saveTeamCache(teamCache);
    console.log(`💾 팀 캐시 갱신됨 → ${path.basename(TEAM_CACHE_PATH)}`);
  }

  console.log(`\n✅ 완료: ${updatedCount}건 업데이트 / ${skipCount}건 스킵`);
}

main().catch(err => {
  console.error('❌ [footystats 업데이트] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});