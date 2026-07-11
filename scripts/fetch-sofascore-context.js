// scripts/fetch-sofascore-context.js
// 오늘자 database/{date}.json 중 축구/농구/배구/하키 경기에 대해 SofaScore 비공식 API로
// H2H·최근폼·라인업(포메이션 포함)·선수사진을 수집해
// database/sofascore-context-{date}.json 으로 저장한다.
// (배당(odds)은 최근폼/H2H 평균 기반 자체 예상스코어 시스템이 이미 있어 수집 대상에서 제외)
//
// ⚠️ 실행 순서: uefa/espn/kbo/npb/kbl 등 리그별 수집 스크립트보다 먼저 실행되어야 한다
//    (main-auto.js 참고). SofaScore는 종목 상관없이 폭넓게 커버하는 "기반" 데이터이고,
//    리그별 스크립트들은 여기서 못 채우는 부분(특히 결장자/부상자 — SofaScore는 제공 안 함)을
//    보강하는 역할이다.
//
// 야구/LOL은 이미 시즌 초반부터 자체 DB(all-fixtures)가 쌓여 있어 대상에서 제외했다.
// (필요해지면 sofascore-common.js의 CAT_TO_SOFASCORE_SPORT에 추가하면 됨)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CAT_TO_SOFASCORE_SPORT,
  fetchSofascoreContext,
} from './sofascore-common.js';
import { closeSofascoreBrowser } from './sofascore-browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

// analyze-router-one-git.js의 cat 판별 로직을 간소화해서 재사용.
// 여기서는 "SofaScore 조회를 시도할지 말지"만 결정하는 용도라 완벽히 정확할 필요는 없다 —
// 종목을 잘못 짚어도 fetchSofascoreContext()가 팀 검색에 실패하면 그냥 스킵될 뿐이다.
function detectCategory(match) {
  const apiSport = (match.sport || '').toLowerCase();
  if (CAT_TO_SOFASCORE_SPORT[apiSport]) return apiSport;

  const lg = (match.league || '').toUpperCase();
  if (lg.includes('NBA') || lg.includes('KBL') || lg.includes('WKBL') || lg.includes('CBA') || lg.includes('B.LEAGUE') || lg.includes('MPBL')) return 'basketball';
  if (lg.includes('V-LEAGUE') || lg.includes('KOVO')) return 'volleyball';
  if (lg.includes('NHL') || lg.includes('KHL')) return 'hockey';
  const isSoccer =
    lg.includes('PREMIER') || lg.includes('LALIGA') || lg.includes('BUNDESLIGA') ||
    lg.includes('SERIE') || lg.includes('LIGUE') || lg.includes('K LEAGUE') ||
    lg.includes('DIVISION') || lg.includes('SUPER LEAGUE') || lg.includes('CHAMPIONSHIP') ||
    lg.includes('WORLD CUP') || lg.includes('EURO') || lg.includes('OLYMPIC') ||
    lg.includes('UEFA') || lg.includes('CONMEBOL') || lg.includes('COPA');
  if (isSoccer) return 'soccer';
  return null;
}

async function main() {
  console.log('🌐 [SofaScore 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/sofascore-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — SofaScore 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const targetMatches = matches
    .filter(m => m.homeScore === null || m.homeScore === undefined) // 완료된 경기 제외
    .map(m => ({ match: m, cat: detectCategory(m) }))
    .filter(({ cat }) => cat && CAT_TO_SOFASCORE_SPORT[cat]);

  if (targetMatches.length === 0) {
    console.log('ℹ️ 오늘자 대상 경기(축구/농구/배구/하키) 없음.');
    return;
  }

  console.log(`🎯 대상 경기: ${targetMatches.length}건\n`);

  const results = [];
  let okCount = 0, skipCount = 0;

  for (const { match, cat } of targetMatches) {
    const sportName = CAT_TO_SOFASCORE_SPORT[cat];
    console.log(`🔍 [${cat}] ${match.home} vs ${match.away}`);

    try {
      const ctx = await fetchSofascoreContext({
        homeTeamEn: match.home,
        awayTeamEn: match.away,
        matchDateStr: match.date,
        sportName,
      });

      if (!ctx) {
        console.log(`   ⚠️ 이벤트 매칭 실패 — 팀명 매칭 또는 SofaScore 미커버 리그일 수 있음`);
        skipCount++;
        continue;
      }

      results.push({
        home: match.home,
        away: match.away,
        date: match.date,
        league: match.league,
        category: cat,
        ...ctx,
      });

      okCount++;
      const lineupStatus = ctx.lineups ? (ctx.lineups.confirmed ? '확정' : '예상') : 'X';
      console.log(`   ✅ H2H ${ctx.h2h.length}건 / 최근폼 홈${ctx.recent.home.length}·원정${ctx.recent.away.length}건 / 라인업${lineupStatus}`);
    } catch (err) {
      console.error(`   ❌ 수집 실패:`, err.message);
      skipCount++;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [SofaScore 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main().finally(() => closeSofascoreBrowser());