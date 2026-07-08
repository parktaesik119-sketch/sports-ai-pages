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

async function main() {
  const beforeHash = process.argv[2];
  if (!beforeHash) {
    console.error('❌ 사용법: node notify-lineup-telegram.js <이전 커밋 해시>');
    process.exit(1);
  }

  const files = getModifiedMdFiles(beforeHash);
  if (files.length === 0) {
    console.log('ℹ️ 라인업이 갱신된 파일이 없어 알림을 보내지 않습니다.');
    return;
  }

  // 날짜 > 종목 > 리그 3단 그룹핑 (notify-posts-telegram.js와 동일한 방식으로 통일)
  const grouped = {};

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const homeTeam = parseFrontmatterField(content, 'homeTeam');
    const awayTeam = parseFrontmatterField(content, 'awayTeam');
    const date = parseFrontmatterField(content, 'date');
    const category = parseFrontmatterField(content, 'category') || 'etc';
    const league = parseFrontmatterField(content, 'league') || '';
    const slug = parseFrontmatterField(content, 'slug');
    if (!homeTeam || !awayTeam) continue;

    const dateLabel = toShortDate(date);
    const sportLabel = SPORT_LABEL_KO[category] || category;

    if (!grouped[dateLabel]) grouped[dateLabel] = {};
    if (!grouped[dateLabel][sportLabel]) grouped[dateLabel][sportLabel] = {};
    if (!grouped[dateLabel][sportLabel][league]) grouped[dateLabel][sportLabel][league] = [];

    const lineText = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
    const url = buildPostUrl(slug);
    grouped[dateLabel][sportLabel][league].push(url ? `<a href="${url}">${lineText}</a>` : lineText);
  }

  const dateLabels = Object.keys(grouped).sort();
  if (dateLabels.length === 0) {
    console.log('ℹ️ 팀 정보를 읽지 못해 알림을 보내지 않습니다.');
    return;
  }

  const dateBlocks = dateLabels.map(dateLabel => {
    const sports = grouped[dateLabel];
    const sportBlocks = Object.keys(sports).map(sportLabel => {
      const leagues = sports[sportLabel];
      const leagueBlocks = Object.keys(leagues).map(league => {
        const matches = leagues[league];
        return league ? [`<b>${league}</b>`, ...matches].join('\n') : matches.join('\n');
      });
      return [`<b>${sportLabel}</b>`, leagueBlocks.join('\n\n')].join('\n');
    });
    return [`<b>${dateLabel}</b>`, '', sportBlocks.join('\n\n')].join('\n');
  });

  const body = dateBlocks.join('\n\n\n');
  const total = dateLabels.reduce((sum, d) =>
    sum + Object.values(grouped[d]).reduce((s2, leagues) =>
      s2 + Object.values(leagues).reduce((s3, matches) => s3 + matches.length, 0), 0), 0);

  const message = ['<b>라인업 업데이트</b>', '', body].join('\n');

  await sendTelegramMessage(message);
  console.log(`✅ 라인업 업데이트 알림 발송 완료 (${total}건, ${dateLabels.length}개 날짜)`);
}

main();