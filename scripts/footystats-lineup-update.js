// scripts/footystats/footystats-lineup-update.js
// kbo-lineup-update.js / uefa-lineup-update.js와 같은 패턴 — 이미 생성된 축구 분석글의
// homeTeam/awayTeam(한글)을 읽어서 footystats.org에서 H2H/최근폼/스쿼드+선수사진을
// 수집해온다. api-sports를 전혀 호출하지 않으므로 무료 호출 한도(100회/일)와 무관하게
// 자유롭게 테스트할 수 있다.
//
// ⚠️ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수 필요 (집 PC 프록시 경유 필수).
//
// ⚠️ 아직 _slug_.astro 쪽에 표시 로직을 안 만들어서, 기존 AI가 써놓은 h2h/homeRecent
// 같은 필드는 건드리지 않고 새 필드(footystatsH2H 등, JSON 문자열)로 따로 저장한다.
// 화면 반영 방식이 정해지면 그때 실제 표시용 필드로 옮기면 됨.

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

async function main() {
  console.log('⚽ footystats 테스트 업데이트 시작\n');

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

    const homeTeamEn = toEnglishTeamName(fm.homeTeam || '');
    const awayTeamEn = toEnglishTeamName(fm.awayTeam || '');

    console.log(`\n🔍 ${path.basename(filePath)}`);
    console.log(`   홈: ${fm.homeTeam} → ${homeTeamEn} / 원정: ${fm.awayTeam} → ${awayTeamEn}`);

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
      if (homeData.countrySlug && homeData.teamSlug && awayData.teamSlug) {
        h2h = await getH2H(homeData.countrySlug, homeData.teamSlug, awayData.teamSlug).catch(err => {
          console.error(`   ⚠️ H2H 수집 실패:`, err.message);
          return [];
        });
      }

      const updates = {
        footystatsH2H: JSON.stringify(h2h),
        footystatsRecentHome: JSON.stringify(homeData.recentMatches),
        footystatsRecentAway: JSON.stringify(awayData.recentMatches),
        footystatsSquadHome: JSON.stringify(homeData.squad),
        footystatsSquadAway: JSON.stringify(awayData.squad),
      };

      const ok = updateMdFrontmatter(filePath, updates);
      if (ok) {
        console.log(`   🔄 업데이트 완료 | H2H ${h2h.length}건 / 최근폼 홈${homeData.recentMatches.length}·원정${awayData.recentMatches.length}건 / 스쿼드 홈${homeData.squad.length}명·원정${awayData.squad.length}명`);
        updatedCount++;
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