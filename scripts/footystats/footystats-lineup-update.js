// scripts/footystats/footystats-lineup-update.js
// kbo-lineup-update.js / uefa-lineup-update.js와 같은 패턴 — 이미 생성된 축구 분석글의
// homeTeam/awayTeam(한글)을 읽어서 footystats.org에서 H2H/최근폼/스쿼드+선수사진을
// 수집해온다. api-sports를 전혀 호출하지 않으므로 무료 호출 한도(100회/일)와 무관하게
// 자유롭게 테스트할 수 있다.
//
// ⚠️ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수 필요 (집 PC 프록시 경유 필수).
//
// _slug_.astro 소스를 직접 확인해서 h2h/homeRecent/awayRecent가 기대하는 정확한 스키마를
// 맞췄다(h2h: {date,home,away,score}, homeRecent/awayRecent: {date,home,away,score,result}).
// 다만 기존 AI가 이미 채워놓은 homeRecent/awayRecent(한글명+사이트 내부링크 포함)는
// footystats 데이터보다 품질이 좋으므로 절대 덮어쓰지 않고, "비어있을 때만" 채운다.
// h2h는 보통 자체 DB 기간이 짧아 항상 비어있으므로("[]") 대부분 채워질 것이다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchTeam } from '../espn-common.js';
import {
  searchClub,
  getClubPage,
  parseClubRecentMatches,
  parseClubSquad,
  parseCountrySlug,
  extractTeamSlugFromClubPath,
  getH2H,
  toH2hDisplayFormat,
  toRecentDisplayFormat,
} from './footystats-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const POSTS_DIR  = path.resolve(__dirname, '../../src/content/posts');

// ─────────────────────────────────────────────
// TEAM_NAME_MAP 로드 후 역방향(한글→영문) 생성 — kbo-lineup-update.js와 동일 로직
// ─────────────────────────────────────────────
function buildReverseMap(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const reverse = {};
  for (const [, en, ko] of pairs) {
    if (!reverse[ko]) reverse[ko] = en;
  }
  return reverse;
}
const TEAM_MAP_PATH = path.resolve(__dirname, '../team_name_map.js');
const KO_TO_EN = buildReverseMap(TEAM_MAP_PATH);
function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

// 영문 → 한글 정방향 매핑 (footystats에서 가져온 팀명을 한글로 되돌리는 용도)
function buildForwardMap(mapFilePath) {
  const content = fs.readFileSync(mapFilePath, 'utf-8');
  const pairs   = [...content.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
  const forward = {};
  for (const [, en, ko] of pairs) {
    forward[en] = ko;
  }
  return forward;
}
const EN_TO_KO = buildForwardMap(TEAM_MAP_PATH);
const ALL_MAPPED_EN_NAMES = Object.keys(EN_TO_KO);

// footystats가 준 팀명(영문, 표기가 team_name_map.js와 정확히 안 맞을 수 있음)을
// 한글로 치환. 정확히 일치하는 게 없으면 matchTeam()으로 가장 가까운 걸 찾고,
// 그마저도 없으면 원문(영문)을 그대로 둔다(무리하게 억지로 안 바꿈).
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

// ─────────────────────────────────────────────
// md frontmatter 파싱/업데이트 — kbo-lineup-update.js와 동일
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
    squad: parseClubSquad($),
  };
}

// fm에서 읽은 값(따옴표 포함된 원문 문자열일 수 있음)이 사실상 빈 배열인지 판단.
// parseFrontmatter()가 큰따옴표만 벗겨내고 작은따옴표(h2h: '[]' 같은 경우)는 그대로
// 남기므로, 앞뒤 따옴표를 한 번 더 벗겨내고 비교한다.
function isEmptyArrayField(raw) {
  if (!raw) return true;
  const stripped = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  return stripped === '' || stripped === '[]';
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

    const needH2h         = isEmptyArrayField(fm.h2h);
    const needHomeRecent  = isEmptyArrayField(fm.homeRecent);
    const needAwayRecent  = isEmptyArrayField(fm.awayRecent);

    // h2h/homeRecent/awayRecent가 이미 다 채워져 있으면 footystats를 부를 필요가 없음
    // (기존 좋은 데이터는 절대 덮어쓰지 않으므로, 채울 게 없으면 그냥 스킵)
    if (!needH2h && !needHomeRecent && !needAwayRecent) {
      skipCount++;
      continue;
    }

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);
    console.log(`   채울 것: h2h=${needH2h} homeRecent=${needHomeRecent} awayRecent=${needAwayRecent}`);

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

      let h2h = [];
      if (needH2h && homeData.countrySlug && homeData.teamSlug && awayData.teamSlug) {
        h2h = await getH2H(homeData.countrySlug, homeData.teamSlug, awayData.teamSlug).catch(err => {
          console.error(`   ⚠️ H2H 수집 실패:`, err.message);
          return [];
        });
      }

      const updates = {};
      if (needH2h && h2h.length > 0) {
        updates.h2h = JSON.stringify(toH2hDisplayFormat(translateMatchList(h2h)));
      }
      if (needHomeRecent && homeData.recentMatches.length > 0) {
        updates.homeRecent = JSON.stringify(
          toRecentDisplayFormat(translateMatchList(homeData.recentMatches), fm.homeTeam)
        );
      }
      if (needAwayRecent && awayData.recentMatches.length > 0) {
        updates.awayRecent = JSON.stringify(
          toRecentDisplayFormat(translateMatchList(awayData.recentMatches), fm.awayTeam)
        );
      }
      // 스쿼드(전체 선수+포지션+사진)는 아직 _slug_.astro에 표시 로직이 없어서
      // 별도 필드에 계속 보관해둔다. 화면 반영 방식이 정해지면 그때 옮기면 됨.
      if (homeData.squad.length > 0) updates.footystatsSquadHome = JSON.stringify(homeData.squad);
      if (awayData.squad.length > 0) updates.footystatsSquadAway = JSON.stringify(awayData.squad);

      if (Object.keys(updates).length > 0) {
        const ok = updateMdFrontmatter(filePath, updates);
        if (ok) {
          console.log(`   🔄 업데이트 완료 | ${Object.keys(updates).join(', ')}`);
          updatedCount++;
        }
      } else {
        console.log(`   ℹ️ 채울 것 없음 (footystats에도 데이터가 없었음)`);
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