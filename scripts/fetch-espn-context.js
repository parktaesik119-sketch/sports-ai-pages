// scripts/fetch-espn-context.js
// database/{date}.json을 읽어서 ESPN이 지원하는 경기의
// 결장자(injuries), 리그 순위(standings), 상대전적(H2H)을 수집합니다.
// 결과는 database/espn-context-{date}.json 으로 저장합니다.
//
// 이 파일은 analyze-router-one-git.js보다 먼저 실행되어야 합니다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ESPN_SPORTS,
  detectEspnSport,
  fetchEspnEvents,
  findMatchingEvent,
  fetchSummary,
  fetchStandings,
  extractTeamStanding,
  extractInjuries,
  extractH2H,
} from './espn-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 날짜 문자열(YYYY-MM-DD)에 UTC 기준 일수를 더합니다.
function addUtcDays(dateStr, amount) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

// 경기 시각이 포함된 원본 timestamp에서 UTC 날짜를 구합니다.
function getMatchUtcDate(matchDate) {
  if (!matchDate) return null;

  const date = new Date(matchDate);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

async function getScoreboardEvents(espnSport, dateStr, scoreboardCache) {
  const cacheKey = `${espnSport}_${dateStr}`;

  if (!Object.prototype.hasOwnProperty.call(scoreboardCache, cacheKey)) {
    scoreboardCache[cacheKey] = await fetchEspnEvents(espnSport, dateStr);
    // ESPN API에 연속 요청이 몰리지 않도록 잠시 대기합니다.
    await sleep(400);
  }

  return scoreboardCache[cacheKey];
}

// 경기 날짜 전후 하루까지 조회합니다.
// ESPN의 dates 파라미터와 이벤트 timestamp의 날짜가 다를 수 있기 때문입니다.
async function findEventForMatch(
  espnSport,
  match,
  scoreboardCache
) {
  const matchUtcDate = getMatchUtcDate(match.date);
  if (!matchUtcDate) return null;

  const queryDates = [-1, 0, 1]
    .map(offset => addUtcDays(matchUtcDate, offset))
    .filter(Boolean);

  const eventMap = new Map();

  for (const queryDate of queryDates) {
    const events = await getScoreboardEvents(
      espnSport,
      queryDate,
      scoreboardCache
    );

    if (!Array.isArray(events)) continue;

    for (const event of events) {
      if (event?.id) {
        eventMap.set(String(event.id), event);
      }
    }
  }

  const combinedEvents = [...eventMap.values()];

  // 팀 이름뿐 아니라 실제 경기 timestamp도 비교해 동명이팀의 다른 경기를 방지합니다.
  return findMatchingEvent(
    combinedEvents,
    match.home,
    match.away,
    match.date,
    36
  );
}

async function main() {
  console.log('🩺 [ESPN 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath = path.resolve(
    __dirname,
    `../database/espn-context-${today}.json`
  );

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — ESPN 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  let matches;
  try {
    matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (error) {
    console.error(`❌ 경기 데이터 JSON을 읽지 못했습니다: ${error.message}`);
    return;
  }

  if (!Array.isArray(matches)) {
    console.error('❌ 경기 데이터 형식이 배열이 아닙니다. 수집을 중단합니다.');
    return;
  }

  // 사이트 운영 종목 중 ESPN이 지원하는 종목만 처리합니다.
  // volleyball, lol 등 ESPN 미지원 종목은 기존 수집 방식을 유지합니다.
  const targetSports = new Set([
    'soccer',
    'basketball',
    'baseball',
    'hockey',
  ]);

  // 같은 종목/날짜의 스코어보드 중복 호출을 방지합니다.
  const scoreboardCache = {};
  const standingsCache = {};

  const results = [];
  let okCount = 0;
  let skipCount = 0;

  for (const match of matches) {
    const sport = String(match.sport || '').toLowerCase();

    if (!targetSports.has(sport)) {
      skipCount++;
      continue;
    }

    if (!match.home || !match.away || !match.date) {
      console.log('⚠️ [경기 정보 부족] 홈팀/원정팀/경기 날짜가 없어 건너뜁니다.');
      skipCount++;
      continue;
    }

    const espnSport = detectEspnSport(
      sport,
      match.league || '',
      match.country || '',
      match.date || ''
    );

    if (!espnSport || !ESPN_SPORTS[espnSport]) {
      skipCount++;
      continue;
    }

    const matched = await findEventForMatch(
      espnSport,
      match,
      scoreboardCache
    );

    if (!matched) {
      console.log(
        `⚠️ [매칭 실패] ${match.home} vs ${match.away} (${ESPN_SPORTS[espnSport].label})`
      );
      skipCount++;
      continue;
    }

    const { event } = matched;
    const gameId = event.id;

    let summary = null;
    try {
      summary = await fetchSummary(espnSport, gameId);
    } catch (error) {
      console.log(
        `⚠️ [요약 조회 실패] ${match.home} vs ${match.away}: ${error.message}`
      );
    }
    await sleep(500);

    const injuries = summary
      ? extractInjuries(summary, match.home, match.away)
      : { home: [], away: [] };

    const h2h = summary ? extractH2H(summary, match.date) : null;

    // 순위 데이터는 종목 단위로 한 번만 호출하고 재사용합니다.
    if (!Object.prototype.hasOwnProperty.call(standingsCache, espnSport)) {
      try {
        standingsCache[espnSport] = await fetchStandings(espnSport);
      } catch (error) {
        console.log(
          `⚠️ [순위 조회 실패] ${ESPN_SPORTS[espnSport].label}: ${error.message}`
        );
        standingsCache[espnSport] = null;
      }
      await sleep(400);
    }

    const standingsData = standingsCache[espnSport];
    const homeStanding = standingsData
      ? extractTeamStanding(standingsData, match.home)
      : null;
    const awayStanding = standingsData
      ? extractTeamStanding(standingsData, match.away)
      : null;

    const hasAnyData =
      injuries.home.length > 0 ||
      injuries.away.length > 0 ||
      homeStanding ||
      awayStanding ||
      h2h;

    if (!hasAnyData) {
      console.log(
        `ℹ️ [데이터 없음] ${match.home} vs ${match.away} — 매칭은 됐지만 결장자/순위/H2H 정보가 없습니다.`
      );
    }

    results.push({
      home: match.home,
      away: match.away,
      date: match.date,
      league: match.league,
      sport,
      espnSport,
      gameId,
      injuries,
      standings: {
        home: homeStanding,
        away: awayStanding,
      },
      h2h,
    });

    okCount++;
    console.log(
      `✅ [수집] ${match.home} vs ${match.away}` +
      ` | 결장 홈${injuries.home.length}/원정${injuries.away.length}` +
      ` | 순위 ${homeStanding?.rank || '-'} vs ${awayStanding?.rank || '-'}` +
      ` | H2H ${h2h ? 'O' : 'X'}`
    );
  }

  try {
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ ESPN 컨텍스트 파일 저장 실패: ${error.message}`);
    return;
  }

  console.log(
    `\n✅ [ESPN 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건` +
    ` → ${path.basename(outPath)}`
  );
}

main().catch(error => {
  console.error('❌ [ESPN 컨텍스트 수집 중단]', error);
  process.exitCode = 1;
});