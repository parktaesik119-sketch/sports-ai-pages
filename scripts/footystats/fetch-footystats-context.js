// scripts/footystats/fetch-footystats-context.js
// 오늘자 database/{date}.json 중 축구 경기에 대해 footystats.org에서
// H2H·최근폼·스쿼드(선수+포지션+사진)를 수집해 database/footystats-context-{date}.json 으로 저장한다.
//
// ⚠️ 전제조건: 이 스크립트는 반드시 HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 있는
// 상태로 실행해야 한다(footystats.org는 GitHub Actions IP에서 직접 호출하면 403 차단됨).
// 집 PC의 home-proxy-server.js + cloudflared tunnel이 켜져 있어야 함.
//
// footystats.org는 축구만 지원한다(농구/배구/하키는 대상 아님).

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

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

// api-sports 영문 팀명으로 footystats에서 검색해 가장 가까운 클럽을 고른다.
async function findClub(teamNameEn) {
  const results = await searchClub(teamNameEn);
  for (const r of results) {
    if (matchTeam(r.name, teamNameEn)) return r;
  }
  // 완전 매칭 실패 시, 검색 결과 자체가 이미 유사도순이라 최상위 결과로 폴백
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
  console.log('⚽ [footystats 컨텍스트 수집] 시작\n');

  if (!process.env.HOME_PROXY_URL || !process.env.HOME_PROXY_SECRET) {
    console.log('⚠️ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수 없음 — footystats 컨텍스트 수집을 건너뜁니다.');
    return;
  }

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../../database/footystats-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — footystats 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const soccerMatches = matches.filter(m => {
    if (m.homeScore !== null && m.homeScore !== undefined) return false; // 완료된 경기 제외
    return (m.sport || '').toLowerCase() === 'soccer';
  });

  if (soccerMatches.length === 0) {
    console.log('ℹ️ 오늘자 대상 축구 경기 없음.');
    return;
  }

  console.log(`🎯 대상 경기: ${soccerMatches.length}건\n`);

  const results = [];
  let okCount = 0, skipCount = 0;

  for (const match of soccerMatches) {
    console.log(`🔍 ${match.home} vs ${match.away}`);

    try {
      const homeData = await collectTeamData(match.home);
      if (!homeData) {
        console.log(`   ⚠️ 홈팀 검색 실패: ${match.home}`);
        skipCount++;
        continue;
      }

      const awayData = await collectTeamData(match.away);
      if (!awayData) {
        console.log(`   ⚠️ 원정팀 검색 실패: ${match.away}`);
        skipCount++;
        continue;
      }

      let h2h = [];
      if (homeData.countrySlug && homeData.teamSlug && awayData.teamSlug) {
        h2h = await getH2H(homeData.countrySlug, homeData.teamSlug, awayData.teamSlug).catch(err => {
          console.error(`   ⚠️ H2H 수집 실패:`, err.message);
          return [];
        });
      }

      results.push({
        home: match.home,
        away: match.away,
        date: match.date,
        league: match.league,
        h2h,
        recent: {
          home: homeData.recentMatches,
          away: awayData.recentMatches,
        },
        squad: {
          home: homeData.squad,
          away: awayData.squad,
        },
      });

      okCount++;
      console.log(`   ✅ H2H ${h2h.length}건 / 최근폼 홈${homeData.recentMatches.length}·원정${awayData.recentMatches.length}건 / 스쿼드 홈${homeData.squad.length}명·원정${awayData.squad.length}명`);
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [footystats 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

// ⚠️ main-auto.js는 모든 단계가 하나의 try/catch로 묶여있어서, 이 스크립트가
// 예외를 던지며 종료(non-zero exit)하면 뒤에 이어지는 analyze-router-one-git.js 등
// 나머지 파이프라인 전체가 멈춰버린다. footystats는 집 PC 인프라(프록시/터널)에
// 의존하는 만큼 실패 가능성이 상대적으로 높으므로, 여기서 실패해도 항상 정상 종료(exit 0)
// 하도록 감싸서 나머지 파이프라인에 영향이 안 가게 한다.
main().catch(err => {
  console.error('❌ [footystats 컨텍스트 수집] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});