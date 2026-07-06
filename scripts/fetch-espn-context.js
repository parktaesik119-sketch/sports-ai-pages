// scripts/fetch-espn-context.js
// api-sports/panda/rapid로 만든 오늘자 database/{date}.json을 읽어서
// ESPN이 지원하는 경기에 한해 결장자(injuries)와 리그 순위(standings)를 수집,
// database/espn-context-{date}.json 으로 저장합니다.
//
// 이 파일은 analyze-router-one-git.js보다 먼저 실행되어야 합니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ESPN_SPORTS,
  detectEspnSport,
  fetchEspnEvents,
  fetchEventFromTeamSchedule,
  findMatchingEvent,
  fetchSummary,
  fetchStandings,
  extractTeamStanding,
  extractInjuries,
  extractH2H,
} from './espn-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function main() {
  console.log('🩺 [ESPN 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/espn-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — ESPN 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // 사이트 운영 6종목 중 ESPN이 커버 가능한 것만: soccer, basketball, baseball, hockey
  // (volleyball, lol은 ESPN 미지원 → 기존 web_search 그대로 유지)
  const targetSports = new Set(['soccer', 'basketball', 'baseball', 'hockey']);

  const scoreboardCache  = {}; // key: `${espnSport}_${utcDate}` -> events[]
  const standingsCache   = {}; // key: espnSport -> standingsData

  const results = [];
  let okCount = 0, skipCount = 0;

  for (const match of matches) {
    const sport = (match.sport || '').toLowerCase();
    if (!targetSports.has(sport)) { skipCount++; continue; }

    const espnSport = detectEspnSport(sport, match.league || '', match.country || '', match.date || '');
    if (!espnSport || !ESPN_SPORTS[espnSport]) {
      skipCount++;
      continue;
    }

    // 경기 날짜(KST) → UTC 날짜 변환 후 스코어보드 조회
    const matchDateKST = new Date(match.date);
    const dateOnly = matchDateKST.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const utcDateStr = new Date(`${dateOnly}T00:00:00+09:00`).toISOString().slice(0, 10);

    const cacheKey = `${espnSport}_${utcDateStr}`;
    if (!scoreboardCache[cacheKey]) {
      scoreboardCache[cacheKey] = await fetchEspnEvents(espnSport, utcDateStr);
      await new Promise(r => setTimeout(r, 500));
    }

    let matched = findMatchingEvent(scoreboardCache[cacheKey], match.home, match.away);

    if (!matched) {
      // 팀 스케줄 재시도는 abbr/id가 필요해 범용적으로 어렵기 때문에 일단 스킵 처리.
      // (필요시 팀 약어 매핑표를 추가해 fetchEventFromTeamSchedule 보강 가능)
      console.log(`⚠️ [매칭 실패] ${match.home} vs ${match.away} (${ESPN_SPORTS[espnSport].label})`);
      skipCount++;
      continue;
    }

    const { event } = matched;
    const gameId = event.id;

    const summary = await fetchSummary(espnSport, gameId);
    await new Promise(r => setTimeout(r, 700));

    const injuries = summary ? extractInjuries(summary, match.home, match.away) : { home: [], away: [] };
    const h2h = summary ? extractH2H(summary, match.date) : null;

    // 순위는 종목+리그 단위로 1회만 호출 후 캐시
    if (!(espnSport in standingsCache)) {
      standingsCache[espnSport] = await fetchStandings(espnSport);
      await new Promise(r => setTimeout(r, 500));
    }
    const standingsData = standingsCache[espnSport];
    const homeStanding = standingsData ? extractTeamStanding(standingsData, match.home) : null;
    const awayStanding = standingsData ? extractTeamStanding(standingsData, match.away) : null;

    const hasAnyData =
      injuries.home.length > 0 || injuries.away.length > 0 || homeStanding || awayStanding || h2h;

    if (!hasAnyData) {
      console.log(`ℹ️ [데이터 없음] ${match.home} vs ${match.away} — 매칭은 됐지만 결장자/순위/H2H 정보 없음`);
    }

    results.push({
      home: match.home,
      away: match.away,
      date: match.date, // 동일 팀조합이 시리즈로 여러 번 겹칠 때 날짜로 구분하기 위해 저장
      league: match.league,
      sport,
      espnSport,
      gameId,
      injuries,
      standings: { home: homeStanding, away: awayStanding },
      h2h,
    });

    okCount++;
    console.log(`✅ [수집] ${match.home} vs ${match.away} | 결장 홈${injuries.home.length}/원정${injuries.away.length} | 순위 ${homeStanding?.rank || '-'} vs ${awayStanding?.rank || '-'} | H2H ${h2h ? 'O' : 'X'}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [ESPN 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();