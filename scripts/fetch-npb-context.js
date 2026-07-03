// scripts/fetch-npb-context.js
// api-sports 등으로 만든 오늘자 database/{date}.json을 읽어서, NPB 경기에 한해
// npb.jp의 予告先発投手(예고선발투수) 정적 페이지에서 선발투수 정보를 수집,
// database/npb-context-{date}.json 으로 저장합니다.
//
// ⚠️ 이 페이지는 "내일 경기"의 예고선발을 보여주는 페이지입니다(전날 발표 제도).
//    그래서 이 스크립트가 today.json을 순회할 때, 실제로 매칭되는 건
//    "오늘 저녁까지 이미 예고선발이 발표된, 가까운 미래의 NPB 경기"에 한정됩니다.
//    fetch-espn-context.js/fetch-kbo-context.js와 같은 시점(analyze-router-one-git.js보다 먼저)에
//    실행하되, 매칭 안 되는 경기가 있어도 정상입니다 (아직 발표 전이거나 이미 지난 경기).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchStarterAnnouncements, findNpbGame, parseAnnouncedDate, toKstDateStr } from './npb-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function main() {
  console.log('⚾ [NPB 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/npb-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — NPB 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const npbMatches = matches.filter(m => (m.league || '').toUpperCase() === 'NPB');

  if (npbMatches.length === 0) {
    console.log('ℹ️ 오늘자 NPB 경기 없음.');
    return;
  }

  // 완료된(스코어 있는) 경기는 프리뷰 대상이 아니므로 미리 걸러냄
  const pendingMatches = npbMatches.filter(m => m.homeScore === null || m.homeScore === undefined);
  if (pendingMatches.length === 0) {
    console.log('ℹ️ 오늘자 NPB 경기는 있지만 전부 이미 완료됨(스코어 존재) — 스킵.');
    return;
  }

  console.log(`📡 予告先発投手 페이지 호출...`);
  const { announcedForText, games } = await fetchStarterAnnouncements().catch(err => {
    console.error(`❌ 예고선발 페이지 호출 실패:`, err.message);
    return { announcedForText: null, games: [] };
  });
  const announcedDate = parseAnnouncedDate(announcedForText);
  console.log(`   발표 기준: ${announcedForText || '(파싱 실패)'} (${announcedDate || '날짜 파싱 실패'}) | 총 ${games.length}경기 수집됨`);

  const results = [];
  let okCount = 0, skipCount = 0, dateMismatchCount = 0;

  for (const match of pendingMatches) {
    const matchDateKst = toKstDateStr(match.date);

    if (announcedDate && matchDateKst !== announcedDate) {
      console.log(`⏭️ [날짜 불일치] ${match.home} vs ${match.away} — 경기일 ${matchDateKst} / 예고선발 페이지는 ${announcedDate}분만 제공 중 (이미 지나갔거나 아직 발표 전)`);
      dateMismatchCount++;
      continue;
    }

    const matched = findNpbGame(games, match.home, match.away);
    if (!matched) {
      console.log(`⚠️ [매칭 실패] ${match.home} vs ${match.away} — 날짜는 맞는데 팀명 매칭 안 됨 (NPB_TEAM_NAME_MAP 확인 필요)`);
      skipCount++;
      continue;
    }

    results.push({
      home: match.home,
      away: match.away,
      date: match.date,
      league: match.league,
      venue: matched.venue,
      gameTime: matched.time,
      starters: {
        // 영어(로마자) 이름 우선 사용, 조회 실패 시 일본어 이름으로 폴백
        home: {
          name: matched.home?.pitcherNameEn || matched.home?.pitcherName,
          nameJa: matched.home?.pitcherName,
          playerId: matched.home?.pitcherId,
          photoUrl: matched.home?.photoUrl,
        },
        away: {
          name: matched.away?.pitcherNameEn || matched.away?.pitcherName,
          nameJa: matched.away?.pitcherName,
          playerId: matched.away?.pitcherId,
          photoUrl: matched.away?.photoUrl,
        },
      },
    });

    okCount++;
    console.log(`✅ [수집] ${match.away} @ ${match.home} | 선발: ${matched.away?.pitcherNameEn || matched.away?.pitcherName} vs ${matched.home?.pitcherNameEn || matched.home?.pitcherName}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [NPB 컨텍스트 수집 완료] 성공 ${okCount}건 / 날짜불일치 ${dateMismatchCount}건 / 매칭실패 ${skipCount}건 → ${path.basename(outPath)}`);
}

main();