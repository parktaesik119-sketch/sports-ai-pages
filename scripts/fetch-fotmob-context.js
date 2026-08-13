// scripts/fetch-fotmob-context.js
// api-sports/네이버 등으로 만든 오늘자 database/{date}.json을 읽어서, 축구 경기 중
// match-filter.js를 통과한(=실제로 분석글이 나갈) 경기에 한해 fotmob에서
// 결장자/H2H/최근폼/(가능하면)라인업·포메이션·감독 정보를 미리 수집해
// database/fotmob-context-{date}.json 으로 저장한다.
//
// fetch-espn-context.js와 같은 역할이지만 축구 전용이다 — ESPN이 커버 못 하는 하위
// 리그(구 footystats 담당 영역)의 정보를 분석글 "작성 시점"에 이미 확보해두기 위한
// 것으로, analyze-router-one-git.js보다 먼저 실행되어야 한다.
//
// ⚠️ 라인업: fotmob은 예상 라인업을 킥오프 2~3일 전부터도 미리 공개하는 경우가 많다
// (실사용 확인, 2026-07). 그래서 이제 여기서도 있으면 같이 수집한다 — analyze-router가
// 이걸 AI 프롬프트에 넣어 더 구체적인 분석을 쓰게 하고, homeLineup/homeFormation/
// homeCoach 등 구조화된 필드는 AI가 아니라 이 데이터를 그대로 frontmatter에 박아넣는다
// (AI가 선수명을 잘못 옮겨적거나 지어내는 걸 원천 차단하기 위함). 다만 그래도 이 시점에
// 없는 경우가 많으므로, 못 채운 부분은 기존처럼 fotmob-lineup-update.js가 사후에 채운다.
//
// ⚠️ h2h/recent는 mergeSoccerMatchSources()가 new Date(row.date)로 직접 파싱하고
// homeScore/awayScore 숫자 필드를 기대하기 때문에, fotmob-lineup-update.js가 쓰는
// "26.07.09" 축약 포맷이 아니라 toFotmobH2hRaw/toFotmobRecentRaw(ISO 날짜 + 숫자
// 스코어)를 써야 한다. 절대 Display 버전과 헷갈리면 안 됨.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveHomeFirst,
  findFotmobMatch,
  fetchMatchDetails,
  extractFotmobInjuries,
  toFotmobH2hRaw,
  toFotmobRecentRaw,
  getFormOwnerId,
  formatFotmobLineup,
  extractFotmobCoach,
  POS_LABEL,
} from './fotmob-common.js';
import { isMatchApproved } from './match-filter.js';
import { deriveFormationFromLineup } from './formation-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function getKstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function main() {
  console.log('⚽ [fotmob 컨텍스트 수집] 시작\n');

  const today = getKstToday();
  const dataPath = path.resolve(__dirname, `../database/${today}.json`);
  const outPath  = path.resolve(__dirname, `../database/fotmob-context-${today}.json`);

  if (!fs.existsSync(dataPath)) {
    console.log(`⚠️ ${today}.json 없음 — fotmob 컨텍스트 수집을 건너뜁니다.`);
    return;
  }

  const matches = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // 축구 + 실제 분석 대상(match-filter.js 통과)만 대상으로 삼는다.
  // (전 세계 축구 경기 전체에 다 쏘면 낭비가 크다 — match-filter.js 헤더 코멘트 참고)
  const targets = matches.filter(m => (m.sport || '').toLowerCase() === 'soccer' && isMatchApproved(m));

  console.log(`🎯 대상 경기: ${targets.length}건 (전체 ${matches.length}건 중 축구+승인 대상만)`);

  const results = [];
  let okCount = 0, skipCount = 0;

  for (const match of targets) {
    try {
      const candidate = await findFotmobMatch(match.date, match.home, match.away);
      if (!candidate) {
        skipCount++;
        continue;
      }

      const details = await fetchMatchDetails(candidate.id);
      await new Promise(r => setTimeout(r, 300)); // 과도한 연속 호출 방지

      if (!details) { skipCount++; continue; }

      // fotmob의 general.homeTeam/awayTeam 순서가 우리 DB 기준 홈/원정과 같은지 확인
      // (home↔home, away↔away 두 방향을 모두 봐서 판단 — 자세한 이유는 fotmob-common.js
      // resolveHomeFirst() 주석 참고. 둘 다 애매하면 null이 오므로 이 경기는 건너뛴다.)
      const isHomeFirst = resolveHomeFirst(
        details.general?.homeTeam?.name || '',
        details.general?.awayTeam?.name || '',
        match.home,
        match.away
      );
      if (isHomeFirst === null) {
        console.warn(`⚠️ [홈/원정 판별 불가] ${match.home} vs ${match.away} ↔ fotmob(${details.general?.homeTeam?.name || '?'} vs ${details.general?.awayTeam?.name || '?'}) — 스킵`);
        skipCount++;
        continue;
      }

      // 결장자
      const lineup = details.content?.lineup;
      let injuries = { home: [], away: [] };
      if (lineup) {
        const rawInjuries = extractFotmobInjuries(lineup);
        injuries = isHomeFirst ? rawInjuries : { home: rawInjuries.away, away: rawInjuries.home };
      }

      // 라인업/포메이션/감독 (있을 때만 — 이 시점엔 아직 없는 경우가 더 많음)
      const fotmobHomeTeamLineup = lineup ? (isHomeFirst ? lineup.homeTeam : lineup.awayTeam) : null;
      const fotmobAwayTeamLineup = lineup ? (isHomeFirst ? lineup.awayTeam : lineup.homeTeam) : null;

      const lineupPlayers = {
        home: formatFotmobLineup(fotmobHomeTeamLineup),
        away: formatFotmobLineup(fotmobAwayTeamLineup),
      };

      function resolveFormation(teamLineup, players) {
        if (teamLineup?.formation) return teamLineup.formation;
        if (teamLineup?.starters?.length) {
          const positions = teamLineup.starters.map(p => ({ position: POS_LABEL[p.usualPlayingPositionId] || '' }));
          return deriveFormationFromLineup(positions) || null;
        }
        return null;
      }
      const formation = {
        home: resolveFormation(fotmobHomeTeamLineup, lineupPlayers.home),
        away: resolveFormation(fotmobAwayTeamLineup, lineupPlayers.away),
      };

      const coach = {
        home: extractFotmobCoach(fotmobHomeTeamLineup),
        away: extractFotmobCoach(fotmobAwayTeamLineup),
      };

      // H2H (원본 ISO 날짜 + 숫자 스코어)
      const h2h = toFotmobH2hRaw(details.content?.h2h, match.date);

      // 최근폼 (팀 소유주 id로 홈/원정 판별 — 배열 순서에 의존하지 않음)
      const teamForm = details.content?.matchFacts?.teamForm || [];
      const generalHomeId = String(details.general?.homeTeam?.id ?? '');
      const generalAwayId = String(details.general?.awayTeam?.id ?? '');
      const ourHomeId = isHomeFirst ? generalHomeId : generalAwayId;
      const ourAwayId = isHomeFirst ? generalAwayId : generalHomeId;

      let ourHomeFormArr = [];
      let ourAwayFormArr = [];
      for (const arr of teamForm) {
        const ownerId = getFormOwnerId(arr);
        if (ownerId === ourHomeId) ourHomeFormArr = arr;
        else if (ownerId === ourAwayId) ourAwayFormArr = arr;
      }
      const recent = {
        home: toFotmobRecentRaw(ourHomeFormArr, match.date),
        away: toFotmobRecentRaw(ourAwayFormArr, match.date),
      };

      const hasLineup = lineupPlayers.home.length > 0 || lineupPlayers.away.length > 0;
      const hasAnyData =
        injuries.home.length > 0 || injuries.away.length > 0
        || h2h.length > 0 || recent.home.length > 0 || recent.away.length > 0
        || hasLineup;

      if (!hasAnyData) { skipCount++; continue; }

      results.push({
        home: match.home,
        away: match.away,
        date: match.date,
        league: match.league,
        injuries,
        h2h,
        recent,
        lineup: hasLineup ? lineupPlayers : null,
        formation: hasLineup ? formation : null,
        coach: hasLineup ? coach : null,
      });
      okCount++;
      console.log(`✅ [수집] ${match.home} vs ${match.away} | 결장 홈${injuries.home.length}/원정${injuries.away.length} | h2h ${h2h.length}건 | 최근폼 홈${recent.home.length}·원정${recent.away.length}건 | 라인업${hasLineup ? 'O' : 'X'}`);
    } catch (err) {
      console.error(`❌ [실패] ${match.home} vs ${match.away}:`, err.message);
      skipCount++;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ [fotmob 컨텍스트 수집 완료] 성공 ${okCount}건 / 스킵 ${skipCount}건 → ${path.basename(outPath)}`);
}

main().catch(err => {
  console.error('❌ [fotmob 컨텍스트 수집] 예외 발생, 이 단계만 건너뛰고 계속 진행:', err.message);
});