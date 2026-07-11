// scripts/fetch-kbo-context.js
// api-sports 등으로 만든 오늘자 database/{date}.json을 읽어서, KBO 경기에 한해
// koreabaseball.com 비공개 웹서비스(/ws/*.asmx)로 선발투수 분석/구종 분석/라인업을 수집,
// database/kbo-context-{date}.json 으로 저장합니다.
//
// fetch-espn-context.js와 같은 시점(analyze-router-one-git.js보다 먼저)에 실행되어야 합니다.
// KBO는 ESPN 커버리지에 없어서 이 스크립트가 그 빈자리를 대신합니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchKboGameList,
  findKboGame,
  fetchPitcherRecordAnalysis,
  fetchPitKindAnalysis,
  fetchLineupAnalysis,
  fetchAllInjuryAndRehabEntries,
  getActiveInjuriesForTeam,
  KBO_TEAM_CODE_MAP,
} from './kbo-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

// match.date(UTC ISO) → KST 기준 'YYYYMMDD' 문자열
function toKstDateCode(isoDateStr) {
  const kst = new Date(new Date(isoDateStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  console.log('⚾ [KBO 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/kbo-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — KBO 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const kboMatches = matches.filter(m => (m.league || '').toUpperCase() === 'KBO');
  if (kboMatches.length === 0) {
    console.log('ℹ️ 오늘자 KBO 경기 없음.');
    return;
  }

  const gameListCache = {}; // key: 'YYYYMMDD' -> fetchKboGameList() 결과 배열
  const results = [];
  let okCount = 0, skipCount = 0;

  // 부상자 명단(18) + 치료·재활명단(21) 이력은 팀 필터 없이 시즌 전체를 한 번에 받아오는 게
  // API 호출 비용이 적으므로, 경기 루프 밖에서 딱 1회만 조회하고 팀별 필터링은 로컬에서 처리한다.
  const seasonYear = today.slice(0, 4);
  const allInjuryEntries = await fetchAllInjuryAndRehabEntries(seasonYear).catch(err => {
    console.error(`❌ [부상자/치료재활명단 조회 실패]`, err.message);
    return [];
  });
  console.log(`🏥 [KBO 부상자/치료재활명단] 시즌 전체 ${allInjuryEntries.length}건 로드됨`);

  for (const match of kboMatches) {
    // 이미 스코어가 채워진(=완료된) 경기는 프리뷰 대상이 아니므로 스킵
    if (match.homeScore !== null && match.homeScore !== undefined) {
      skipCount++;
      continue;
    }

    if (!KBO_TEAM_CODE_MAP[match.home] || !KBO_TEAM_CODE_MAP[match.away]) {
      console.log(`⚠️ [팀코드 매핑 없음] ${match.home} vs ${match.away} — KBO_TEAM_CODE_MAP 확인 필요`);
      skipCount++;
      continue;
    }

    const dateCode = toKstDateCode(match.date);
    if (!gameListCache[dateCode]) {
      console.log(`📡 GetKboGameList 호출: ${dateCode}`);
      gameListCache[dateCode] = await fetchKboGameList(dateCode).catch(err => {
        console.error(`❌ GetKboGameList 실패 (${dateCode}):`, err.message);
        return [];
      });
    }

    const matched = findKboGame(gameListCache[dateCode], match.home, match.away);
    if (!matched) {
      console.log(`⚠️ [매칭 실패] ${match.home} vs ${match.away} (${dateCode})`);
      skipCount++;
      continue;
    }

    let pitcherRecord = null, pitKind = null, lineup = null;

    if (matched.away.starterId && matched.home.starterId) {
      [pitcherRecord, pitKind] = await Promise.all([
        fetchPitcherRecordAnalysis({
          leId: matched.leId, srId: matched.srId, seasonId: matched.seasonId,
          awayTeamId: matched.away.id, awayPitId: matched.away.starterId,
          homeTeamId: matched.home.id, homePitId: matched.home.starterId,
          groupSc: 'SEASON',
        }).catch(err => { console.error(`❌ GetPitcherRecordAnalysis 실패:`, err.message); return null; }),
        fetchPitKindAnalysis({
          leId: matched.leId, srId: matched.srId, seasonId: matched.seasonId,
          awayPitId: matched.away.starterId, homePitId: matched.home.starterId,
        }).catch(err => { console.error(`❌ GetPitKindAnalysis 실패:`, err.message); return null; }),
      ]);
    } else {
      console.log(`ℹ️ [선발투수 미발표] ${match.home} vs ${match.away} — 투수분석/구종분석 스킵, 라인업만 시도`);
    }

    lineup = await fetchLineupAnalysis({
      leId: matched.leId, srId: matched.srId, seasonId: matched.seasonId, gameId: matched.gameId,
    }).catch(err => { console.error(`❌ GetLineUpAnalysis 실패:`, err.message); return null; });

    // 홈/원정팀 코드 기준으로 "현재 결장 중"인 선수만 로컬 필터링 (API 재호출 없음)
    const homeTeamCode = KBO_TEAM_CODE_MAP[match.home];
    const awayTeamCode = KBO_TEAM_CODE_MAP[match.away];
    const injuries = {
      home: getActiveInjuriesForTeam(allInjuryEntries, homeTeamCode, today),
      away: getActiveInjuriesForTeam(allInjuryEntries, awayTeamCode, today),
    };

    results.push({
      home: match.home,
      away: match.away,
      date: match.date,
      league: match.league,
      gameId: matched.gameId,
      stadium: matched.stadium,
      standings: {
        home: matched.home.rank ?? null,
        away: matched.away.rank ?? null,
      },
      starters: {
        home: matched.home.starterName,
        away: matched.away.starterName,
      },
      pitcherRecord,
      pitKind,
      lineup,
      injuries,
    });

    okCount++;
    console.log(`✅ [수집] ${match.away} @ ${match.home} | gameId ${matched.gameId} | 투수분석${pitcherRecord ? 'O' : 'X'} 구종분석${pitKind ? 'O' : 'X'} 라인업${lineup ? (lineup.lineupConfirmed ? '확정' : '예상') : 'X'} 결장자(홈${injuries.home.length}/원정${injuries.away.length})`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [KBO 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();