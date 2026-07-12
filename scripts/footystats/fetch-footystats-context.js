// scripts/footystats/fetch-footystats-context.js
// database/{date}.json 중 "실제로 오늘 분석글이 나갈 경기"만 골라서(match-filter.js와
// analyze-router-one-git.js가 완전히 동일한 기준을 씀) footystats.org에서 H2H·최근폼을
// 수집해 database/footystats-context-{date}.json 으로 저장한다.
//
// ⚠️ 예전 버전은 "오늘 수집된 미완료 축구 경기 전체"(하위리그 포함 전 세계)를 대상으로
// 돌아서, 실제로는 절대 분석글이 안 나갈 경기까지 전부 긁느라 시간이 끝없이 걸리는
// 문제가 있었다(2026-07 실사용에서 확인) — match-filter.js로 이 문제를 해결함.
//
// 여기서 만드는 h2h/recent는 analyze-router-one-git.js가 그대로 읽어서 h2hHistory/
// homeRecentMatches/awayRecentMatches에 "부족한 만큼만 보충"하는 용도이므로(KBL과 동일한
// 패턴), 화면 표시용 스키마(result 이모지, 링크 등)로 가공하지 않고 raw 형태
// {date, home, away, homeScore, awayScore}를 영문 원문 그대로 저장한다.
// (한글 치환/화면용 포맷 변환은 footystats-lineup-update.js — 이미 만들어진 글을
// 나중에 갱신하는 별도 스크립트 — 쪽 역할이고, 이 파일과는 무관하다)
//
// 라인업은 여기서 안 다룬다 — analyze-router-one-git.js는 애초에 homeLineup/awayLineup을
// 다루지 않는다(모든 소스가 30분 주기 lineup-update.yml에서 나중에 채우는 구조라서,
// 분석글 최초 생성 시점엔 어차피 대부분 라인업이 공개 전이기 때문). footystats 라인업은
// footystats-lineup-update.js가 계속 담당한다.
//
// ⚠️ 전제조건: 반드시 HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 있는 상태로 실행해야
// 한다(footystats.org는 GitHub Actions IP에서 직접 호출하면 403 차단됨). 집 PC의
// home-proxy-server.js + cloudflared tunnel이 켜져 있어야 함.
//
// footystats.org는 축구만 지원한다(농구/배구/하키는 대상 아님).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchTeam } from '../espn-common.js';
import { isMatchApproved } from '../match-filter.js';
import {
  searchClub,
  getClubPage,
  parseClubRecentMatches,
  parseCountrySlug,
  extractTeamSlugFromClubPath,
  getH2hPage,
  parseH2hMatches,
  strictTeamMatch,
} from './footystats-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function findClub(teamNameEn) {
  const results = await searchClub(teamNameEn);
  for (const r of results) {
    if (strictTeamMatch(r.name, teamNameEn)) return r;
  }
  // 매칭 실패 시 아무거나 폴백하지 않는다(엉뚱한 팀이 잡히는 걸 방지) — 실사용 테스트로
  // "England"가 "New England Revolution"으로 잘못 매칭되는 등의 사고를 겪고 나서 고친 부분.
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

  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // ⚠️ 핵심 수정: "오늘 수집된 미완료 축구 경기 전체"가 아니라, analyze-router-one-git.js가
  // 실제로 분석글을 쓸 경기(isMatchApproved 통과)만 골라낸다. 여기에 더해 축구(soccer)만,
  // 아직 스코어가 안 들어온(미완료) 경기만 대상으로 한다.
  const soccerMatches = rawData.filter(m => {
    const isSoccer = (m.sport || '').toLowerCase() === 'soccer';
    const isIncomplete = m.homeScore === null || m.homeScore === undefined;
    return isSoccer && isIncomplete && isMatchApproved(m);
  });

  if (soccerMatches.length === 0) {
    console.log('ℹ️ 오늘자 분석 대상 축구 경기 없음.');
    return;
  }

  console.log(`🎯 대상 경기: ${soccerMatches.length}건 (분석 대상으로 승인된 경기만)\n`);

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
        h2h = await getH2hPage(homeData.countrySlug, homeData.teamSlug, awayData.teamSlug)
          .then($h2h => parseH2hMatches($h2h))
          .catch(err => {
            console.error(`   ⚠️ H2H 수집 실패:`, err.message);
            return [];
          });
      }

      // ⚠️ 영문 원문 그대로 저장 (analyze-router-one-git.js가 match.home/away와 정확 일치
      // 비교를 해서 승/패 판정을 하기 때문에, 여기서 한글로 바꾸면 판정이 뒤집힐 수 있다)
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
      });

      okCount++;
      console.log(`   ✅ H2H ${h2h.length}건 / 최근폼 홈${homeData.recentMatches.length}·원정${awayData.recentMatches.length}건`);
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [footystats 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main().catch(err => {
  console.error('❌ [footystats 컨텍스트 수집] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});