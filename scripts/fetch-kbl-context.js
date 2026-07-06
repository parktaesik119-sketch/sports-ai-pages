// scripts/fetch-kbl-context.js
// api-sports 등으로 만든 오늘자 database/{date}.json을 읽어서, KBL 경기에 한해
// api.kbl.or.kr(비공식 REST API)로 최근 폼 / 상대전적을 수집,
// database/kbl-context-{date}.json 으로 저장합니다.
//
// fetch-kbo-context.js/fetch-npb-context.js와 같은 시점(analyze-router-one-git.js보다
// 먼저) 실행되어야 합니다.
//
// ⚠️ KBL은 경기 전 라인업 사전공개가 없는 리그라 이 스크립트는 라인업은 다루지 않음
//    (라인업은 경기 시작 후 kbl-lineup-update.js가 별도로 채워넣음).
//    여기서는 "경기 전에 미리 알 수 있는 것" — 최근 폼 / 상대전적만 수집한다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchKblGameList,
  findKblGame,
  fetchKblRecentForm,
  fetchKblHeadToHead,
  toKstDateCode,
  KBL_TEAM_CODE_MAP,
} from './kbl-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────
// KBL API는 팀명을 한글로 내려주는데(예: "한국가스공사"), analyze-router-one-git.js를
// 포함한 나머지 파이프라인은 전부 api-sports 영문 팀명(match.home/match.away, 예:
// "Daegu KOGAS")을 기준으로 문자열을 비교한다. kbl-lineup-update.js와 동일한 방식으로
// team_name_map.js를 역매핑해서, 여기서 수집한 한글 이름을 영문으로 맞춰준다.
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

const TEAM_MAP_PATH = path.resolve(__dirname, './team_name_map.js');
const KO_TO_EN = buildReverseMap(TEAM_MAP_PATH);

function toEnglishTeamName(koName) {
  return KO_TO_EN[koName] || koName;
}

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function main() {
  console.log('🏀 [KBL 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/kbl-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — KBL 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const kblMatches = matches.filter(m => (m.league || '').toUpperCase() === 'KBL');
  if (kblMatches.length === 0) {
    console.log('ℹ️ 오늘자 KBL 경기 없음.');
    return;
  }

  const gameListCache = {}; // key: 'YYYYMMDD' -> fetchKblGameList() 결과 배열
  const results = [];
  let okCount = 0, skipCount = 0;

  for (const match of kblMatches) {
    // 이미 스코어가 채워진(=완료된) 경기는 프리뷰 대상이 아니므로 스킵
    if (match.homeScore !== null && match.homeScore !== undefined) {
      skipCount++;
      continue;
    }

    const homeTcode = KBL_TEAM_CODE_MAP[match.home];
    const awayTcode = KBL_TEAM_CODE_MAP[match.away];
    if (!homeTcode || !awayTcode) {
      console.log(`⚠️ [팀코드 매핑 없음] ${match.home} vs ${match.away} — KBL_TEAM_CODE_MAP 확인 필요`);
      skipCount++;
      continue;
    }

    const dateCode = toKstDateCode(match.date);
    if (!gameListCache[dateCode]) {
      console.log(`📡 match/list 호출: ${dateCode}`);
      gameListCache[dateCode] = await fetchKblGameList(dateCode).catch(err => {
        console.error(`❌ match/list 실패 (${dateCode}):`, err.message);
        return [];
      });
    }

    const matched = findKblGame(gameListCache[dateCode], match.home, match.away);
    if (!matched) {
      console.log(`⚠️ [매칭 실패] ${match.home} vs ${match.away} (${dateCode})`);
      skipCount++;
      continue;
    }

    // 오늘 경기 하루 전날까지 기준으로 최근 폼/상대전적 조회 (당일 경기 자기 자신이 섞이지 않도록)
    const beforeDateCode = dateCode;

    const [homeForm, awayForm, headToHead] = await Promise.all([
      fetchKblRecentForm(homeTcode, beforeDateCode, 5).catch(err => {
        console.error(`❌ 홈팀 최근폼 조회 실패:`, err.message);
        return [];
      }),
      fetchKblRecentForm(awayTcode, beforeDateCode, 5).catch(err => {
        console.error(`❌ 원정팀 최근폼 조회 실패:`, err.message);
        return [];
      }),
      fetchKblHeadToHead(homeTcode, awayTcode, beforeDateCode, 5).catch(err => {
        console.error(`❌ 상대전적 조회 실패:`, err.message);
        return [];
      }),
    ]);

    // KBL API가 주는 한글 팀명(opponent/home/away)을 영문(match.home/away와 동일 기준)으로 변환하고,
    // analyze-router-one-git.js가 기대하는 {date, home, away, homeScore, awayScore} 형태로 맞춘다.
    // recentForm은 원래 "내 팀 시점(myScore/oppScore)"으로 오므로, 실제 그 경기의 홈/원정 배치대로 복원해야 한다.
    function reshapeRecentForm(entries, myTeamEn) {
      return entries.map(e => {
        const oppEn = toEnglishTeamName(e.opponent);
        return e.isHome
          ? { date: e.date, home: myTeamEn, away: oppEn, homeScore: e.myScore, awayScore: e.oppScore }
          : { date: e.date, home: oppEn, away: myTeamEn, homeScore: e.oppScore, awayScore: e.myScore };
      });
    }
    function reshapeHeadToHead(entries) {
      return entries.map(e => ({
        date: e.date,
        home: toEnglishTeamName(e.home),
        away: toEnglishTeamName(e.away),
        homeScore: e.homeScore,
        awayScore: e.awayScore,
      }));
    }

    results.push({
      home: match.home,
      away: match.away,
      date: match.date,
      league: match.league,
      gmkey: matched.gmkey,
      stadium: matched.stadium,
      recentForm: {
        home: reshapeRecentForm(homeForm, match.home),
        away: reshapeRecentForm(awayForm, match.away),
      },
      headToHead: reshapeHeadToHead(headToHead),
    });

    okCount++;
    console.log(`✅ [수집] ${match.away} @ ${match.home} | gmkey ${matched.gmkey} | 최근폼 홈${homeForm.length}건/원정${awayForm.length}건 | 상대전적 ${headToHead.length}건`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [KBL 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();