// scripts/fetch-uefa-context.js
// api-sports 등으로 만든 오늘자 database/{date}.json을 읽어서, UEFA 주관 대회(챔스·컨퍼런스리그)
// 경기에 한해 match.uefa.com에서 경기장/심판/라운드 정보를 수집,
// database/uefa-context-{date}.json 으로 저장합니다.
//
// fetch-kbo-context.js/fetch-npb-context.js와 같은 시점(analyze-router-one-git.js보다 먼저)에
// 실행되어야 합니다.
//
// ⚠️ 이 시점(분석글 생성 시점)은 대개 킥오프 몇 시간~며칠 전이라, 확정 라인업/포메이션은
//    아직 안 나온 경우가 대부분입니다(라인업은 킥오프 1시간 전쯤 나옴 — uefa-lineup-update.js가
//    나중에 별도로 채움). 그래도 혹시 이미 나와 있으면(당일 늦게 도는 경우 등) 같이 담아둡니다.
//
// ⚠️ league 문자열은 api-sports 원본 기준입니다. 챔스 "UEFA Champions League",
//    컨퍼런스리그 "UEFA Europa Conference League" 둘 다 실측 확인됐습니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  UEFA_COMPETITION_ID,
  fetchUefaMatches,
  findUefaMatch,
  fetchUefaLineup,
  toKstDateStr,
} from './uefa-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// api-sports 원본 league 문자열 → UEFA competitionId (둘 다 실측 확인됨)
const LEAGUE_TO_COMPETITION_ID = {
  'UEFA Champions League': UEFA_COMPETITION_ID.UCL,
  'UEFA Europa Conference League': UEFA_COMPETITION_ID.UECL,
};

const AVAILABLE_LINEUP_STATUSES = ['TACTICAL_AVAILABLE', 'CONFIRMED', 'AVAILABLE'];

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function main() {
  console.log('⚽ [UEFA 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/uefa-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — UEFA 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const uefaMatches = matches.filter(m => LEAGUE_TO_COMPETITION_ID[m.league]);

  if (uefaMatches.length === 0) {
    console.log('ℹ️ 오늘자 UEFA(챔스/컨퍼런스리그) 경기 없음.');
    return;
  }

  // 완료된(스코어 있는) 경기는 프리뷰 대상이 아니므로 미리 걸러냄
  const pendingMatches = uefaMatches.filter(m => m.homeScore === null || m.homeScore === undefined);
  if (pendingMatches.length === 0) {
    console.log('ℹ️ 오늘자 UEFA 경기는 있지만 전부 이미 완료됨(스코어 존재) — 스킵.');
    return;
  }

  const scheduleCache = {}; // key: `${competitionId}:${kstDate}` -> fetchUefaMatches() 결과
  const results = [];
  let okCount = 0, skipCount = 0;

  for (const match of pendingMatches) {
    const competitionId = LEAGUE_TO_COMPETITION_ID[match.league];
    const kstDate = match.date ? toKstDateStr(match.date) : null;

    if (!kstDate) {
      console.log(`⚠️ [date 파싱 실패] ${match.home} vs ${match.away}`);
      skipCount++;
      continue;
    }

    const cacheKey = `${competitionId}:${kstDate}`;
    if (!scheduleCache[cacheKey]) {
      console.log(`📡 UEFA 일정 조회: ${kstDate} (competitionId=${competitionId})`);
      scheduleCache[cacheKey] = await fetchUefaMatches({
        competitionId,
        fromDate: kstDate,
        toDate: kstDate,
      }).catch(err => {
        console.error(`❌ UEFA 일정 조회 실패 (${kstDate}):`, err.message);
        return [];
      });
    }

    const matched = findUefaMatch(scheduleCache[cacheKey], match.home, match.away);
    if (!matched) {
      console.log(`⚠️ [매칭 실패] ${match.home} vs ${match.away} (${kstDate}) — UEFA.com 일정에서 대응하는 경기를 못 찾음`);
      console.log(`   → 팀명 표기 차이이거나, api-sports 데이터가 실제 UEFA.com 정보와 다를 수 있음`);
      skipCount++;
      continue;
    }

    // 이 시점엔 대개 라인업 미발표지만, 혹시 이미 나와 있으면 같이 수집
    let lineup = null;
    if (AVAILABLE_LINEUP_STATUSES.includes(matched.lineupStatus)) {
      lineup = await fetchUefaLineup(matched.id).catch(err => {
        console.error(`❌ UEFA 라인업 조회 실패 (matchId ${matched.id}):`, err.message);
        return null;
      });
    }

    results.push({
      home: match.home,
      away: match.away,
      date: match.date,
      league: match.league,
      matchId: matched.id,
      kickOffTime: matched.kickOffTime?.dateTime ?? null,
      round: matched.longName ?? matched.name ?? null,
      phase: matched.phase ?? null,
      stadium: matched.stadium
        ? { name: matched.stadium.name ?? null, city: matched.stadium.city ?? null }
        : null,
      referees: (matched.referees || []).map(r => ({ role: r.role ?? null, name: r.internationalName ?? null })),
      lineupStatus: matched.lineupStatus,
      lineup, // null이면 아직 미발표 (uefa-lineup-update.js가 나중에 채움)
    });

    okCount++;
    console.log(`✅ [수집] ${match.away} @ ${match.home} | matchId ${matched.id} | ${matched.stadium?.name || '경기장 정보 없음'} | 라인업${lineup ? 'O' : 'X'}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [UEFA 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();