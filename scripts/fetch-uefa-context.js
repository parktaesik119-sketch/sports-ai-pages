// scripts/fetch-uefa-context.js
// api-sports 등으로 만든 오늘자 database/{date}.json을 읽어서, UEFA 주관 대회(챔스·컨퍼런스리그·유로파리그)
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
//    유로파리그는 "UEFA Europa League"로 가정해서 등록했으나, 아직 api-sports 원본
//    database/{date}.json으로 실측 확인은 안 됐습니다 — 처음 유로파리그 경기가 들어오면
//    league 필드값을 한 번 확인해볼 것.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  UEFA_COMPETITION_ID,
  fetchUefaMatches,
  findUefaMatch,
  fetchUefaLineup,
  fetchUefaHeadToHead,
  toKstDateStr,
} from './uefa-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// api-sports 원본 league 문자열 → UEFA competitionId
// ⚠️ 챔스/컨퍼런스리그 문자열은 실측 확인됨. 유로파리그는 UEFA.com 쪽 competitionId(14)만
//    실측 확인됐고, api-sports가 실제로 이 문자열("UEFA Europa League") 그대로 주는지는
//    아직 database/{date}.json 원본으로 재확인 안 됨 — 다르면 이 키만 고치면 된다.
const LEAGUE_TO_COMPETITION_ID = {
  'UEFA Champions League': UEFA_COMPETITION_ID.UCL,
  'UEFA Europa Conference League': UEFA_COMPETITION_ID.UECL,
  'UEFA Europa League': UEFA_COMPETITION_ID.UEL,
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
    // ⚠️ matched.lineupStatus(일정 목록 API의 값)는 신뢰할 수 없음이 실측 확인됨(경기가
    //    끝난 뒤에도 NOT_AVAILABLE로 고정). 게이트 없이 일단 호출해보고 응답 자체의
    //    lineupStatus로 판단한다.
    let lineup = await fetchUefaLineup(matched.id).catch(err => {
      console.error(`❌ UEFA 라인업 조회 실패 (matchId ${matched.id}):`, err.message);
      return null;
    });
    if (lineup && !AVAILABLE_LINEUP_STATUSES.includes(lineup.lineupStatus)) {
      lineup = null; // 아직 미발표 — null로 남겨서 uefa-lineup-update.js가 나중에 채우도록 함
    }

    // 상대전적(h2h) — 1차 예선처럼 첫 만남인 라운드는 항상 빈 배열이 정상
    const homeTeamId = matched.homeTeam?.id;
    const awayTeamId = matched.awayTeam?.id;
    const h2h = await fetchUefaHeadToHead(competitionId, homeTeamId, awayTeamId, matched.id).catch(err => {
      console.error(`❌ UEFA h2h 조회 실패 (matchId ${matched.id}):`, err.message);
      return [];
    });

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
      lineupStatus: lineup?.lineupStatus ?? matched.lineupStatus, // 라인업 API 응답값이 있으면 그걸 우선 신뢰
      lineup, // null이면 아직 미발표 (uefa-lineup-update.js가 나중에 채움)
      h2h, // 빈 배열이면 과거 맞대결 없음(1차 예선은 대부분 이게 정상)
    });

    okCount++;
    console.log(`✅ [수집] ${match.away} @ ${match.home} | matchId ${matched.id} | ${matched.stadium?.name || '경기장 정보 없음'} | 라인업${lineup ? 'O' : 'X'} | h2h${h2h.length}건`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [UEFA 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();