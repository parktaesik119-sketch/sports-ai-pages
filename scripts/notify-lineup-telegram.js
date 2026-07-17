// scripts/notify-lineup-telegram.js
// 실행: node notify-lineup-telegram.js <이전 커밋 해시>
//
// espn-boxscore-update.js가 라인업을 갱신하면서 수정한 .md 파일들을 찾아서
// "라인업 업데이트" 알림을 한 번에 보냅니다.
//
// lineup-update.yml에 끼워넣는 방법 (git push 하기 전):
//   - name: Run lineup update script
//     run: |
//       BEFORE_HASH=$(git rev-parse HEAD)
//       node scripts/espn-boxscore-update.js
//       node scripts/notify-lineup-telegram.js "$BEFORE_HASH"
//     env:
//       TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
//       TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseFrontmatterField, toShortDate, sendTelegramMessage, SPORT_LABEL_KO, buildPostUrl, escapeHtml } from './telegram-common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function getModifiedMdFiles(beforeHash) {
  const output = execSync(
    `git diff --name-only --diff-filter=M ${beforeHash} HEAD -- src/content/posts/`,
    { cwd: REPO_ROOT }
  ).toString().trim();

  if (!output) return [];
  return output
    .split('\n')
    .filter(f => f.endsWith('.md'))
    .map(f => path.resolve(REPO_ROOT, f));
}

// 알림 대상에서 제외할 frontmatter 필드.
// espn-boxscore-update.js가 최근전적/상대전적을 갱신하는 것만으로도
// 파일이 "수정됨"으로 잡히는데, 이건 라인업 업데이트가 아니므로 알림 트리거에서 제외한다.
const IGNORED_FIELDS = new Set(['h2h', 'homeRecent', 'awayRecent']);

// 해당 파일의 diff에서 실제로 바뀐 frontmatter 필드 이름들을 뽑아온다.
// (+/- 로 시작하는 "필드명: 값" 형태의 라인만 매칭)
function getChangedFrontmatterFields(beforeHash, filePath) {
  const relPath = path.relative(REPO_ROOT, filePath);
  const diff = execSync(
    `git diff ${beforeHash} HEAD -- "${relPath}"`,
    { cwd: REPO_ROOT }
  ).toString();

  const fields = new Set();
  const fieldLineRe = /^[+-]([A-Za-z0-9_]+):\s?/;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue; // diff 헤더 제외
    const m = line.match(fieldLineRe);
    if (m) fields.add(m[1]);
  }
  return fields;
}

// 이번 diff에서 IGNORED_FIELDS 외의 필드가 하나라도 바뀌었으면 "진짜 라인업 업데이트"로 간주.
// h2h/homeRecent/awayRecent만 바뀐 파일은 false를 반환해 알림 대상에서 제외한다.
function isRealLineupUpdate(beforeHash, filePath) {
  const changedFields = getChangedFrontmatterFields(beforeHash, filePath);
  for (const field of changedFields) {
    if (!IGNORED_FIELDS.has(field)) return true;
  }
  return false;
}

async function main() {
  const beforeHash = process.argv[2];
  if (!beforeHash) {
    console.error('❌ 사용법: node notify-lineup-telegram.js <이전 커밋 해시>');
    process.exit(1);
  }

  const allModifiedFiles = getModifiedMdFiles(beforeHash);
  if (allModifiedFiles.length === 0) {
    console.log('ℹ️ 라인업이 갱신된 파일이 없어 알림을 보내지 않습니다.');
    return;
  }

  // h2h/homeRecent/awayRecent만 바뀐 파일(라인업과 무관한 갱신)은 알림 대상에서 제외
  const files = allModifiedFiles.filter(f => isRealLineupUpdate(beforeHash, f));
  const skippedNonLineup = allModifiedFiles.length - files.length;

  if (files.length === 0) {
    console.log(`ℹ️ 라인업 변경 없이 최근전적/상대전적만 갱신된 파일뿐이라 알림을 보내지 않습니다 (${skippedNonLineup}건 제외)`);
    return;
  }

  // 날짜 > 종목 > 리그 3단 그룹핑 (notify-posts-telegram.js와 동일한 방식으로 통일)
  const grouped = {};
  // 리그명 옆에 국가명을 붙이기 위한 매핑. 같은 리그는 항상 같은 국가라고 가정하고
  // 처음 등장한 글의 country 값을 기준으로 삼는다. (notify-posts-telegram.js와 동일)
  const leagueCountry = {};
  const now = new Date(); // 알림 발송 시점 기준. 이 시점 이후 킥오프인 경기만 알림 대상.
  let skippedStarted = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const homeTeam = parseFrontmatterField(content, 'homeTeam');
    const awayTeam = parseFrontmatterField(content, 'awayTeam');
    const date = parseFrontmatterField(content, 'date');
    const category = parseFrontmatterField(content, 'category') || 'etc';
    const league = parseFrontmatterField(content, 'league') || '';
    const country = parseFrontmatterField(content, 'country') || '';
    const slug = parseFrontmatterField(content, 'slug');
    if (!homeTeam || !awayTeam) continue;

    // 이미 킥오프한 경기는 새로 보러 온 사람에게 의미가 없으니 알림에서 제외
    // (기존 글 완성도 보강 목적의 백그라운드 수집이지, "곧 시작하는 경기 라인업 나왔어요" 알림이 아님)
    if (date) {
      const kickoff = new Date(date);
      if (!isNaN(kickoff.getTime()) && kickoff <= now) {
        skippedStarted++;
        continue;
      }
    }

    const dateLabel = toShortDate(date);
    const sportLabel = SPORT_LABEL_KO[category] || category;

    if (!grouped[dateLabel]) grouped[dateLabel] = {};
    if (!grouped[dateLabel][sportLabel]) grouped[dateLabel][sportLabel] = {};
    if (!grouped[dateLabel][sportLabel][league]) grouped[dateLabel][sportLabel][league] = [];
    if (league && country && !leagueCountry[league]) leagueCountry[league] = country;

    const lineText = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
    const url = buildPostUrl(slug);
    grouped[dateLabel][sportLabel][league].push(url ? `<a href="${url}">${lineText}</a>` : lineText);
  }

  const dateLabels = Object.keys(grouped).sort();
  if (dateLabels.length === 0) {
    console.log(`ℹ️ 알림 보낼 대상 없음 (이미 시작된 경기 ${skippedStarted}건, 최근전적/상대전적만 갱신된 ${skippedNonLineup}건 제외 처리됨)`);
    return;
  }

  const dateBlocks = dateLabels.map(dateLabel => {
    const sports = grouped[dateLabel];
    const sportBlocks = Object.keys(sports).map(sportLabel => {
      const leagues = sports[sportLabel];
      const leagueBlocks = Object.keys(leagues).map(league => {
        const matches = leagues[league];
        if (!league) return matches.join('\n');
        const country = leagueCountry[league];
        const leagueLabel = country ? `${country} ${league}` : league;
        return [`<b>${leagueLabel}</b>`, ...matches].join('\n');
      });
      return [`<b>${sportLabel}</b>`, leagueBlocks.join('\n\n')].join('\n');
    });
    return [`<b>${dateLabel}</b>`, '', sportBlocks.join('\n\n')].join('\n');
  });

  const body = dateBlocks.join('\n\n\n');
  const total = dateLabels.reduce((sum, d) =>
    sum + Object.values(grouped[d]).reduce((s2, leagues) =>
      s2 + Object.values(leagues).reduce((s3, matches) => s3 + matches.length, 0), 0), 0);

  const message = ['<b>📢 라인업 업데이트</b>', '', body].join('\n');

  await sendTelegramMessage(message);
  console.log(`✅ 라인업 업데이트 알림 발송 완료 (${total}건, ${dateLabels.length}개 날짜, 이미 시작된 경기 ${skippedStarted}건 제외, 최근전적/상대전적만 갱신된 ${skippedNonLineup}건 제외)`);
}

main();