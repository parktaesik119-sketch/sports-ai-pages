// scripts/notify-posts-telegram.js
// 실행: node notify-posts-telegram.js <이전 커밋 해시>
//
// analyze-router-one-git.js가 새로 생성한 .md 파일들을 찾아서
// 종목별로 묶어 "신규 분석글 업데이트" 알림을 한 번에 보냅니다.
//
// main-auto.js에 끼워넣는 방법:
//   const beforeHash = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
//   execSync('node analyze-router-one-git.js', { stdio: 'inherit', cwd: __dirname });
//   execSync('node inject-links.js', { stdio: 'inherit', cwd: __dirname });
//   execSync(`node notify-posts-telegram.js ${beforeHash}`, { stdio: 'inherit', cwd: __dirname });
//
// (inject-links.js는 기존 파일을 "수정"만 하지 "추가"는 안 하니, 아래 diff-filter=A 기준엔 안 잡힙니다)

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseFrontmatterField, toShortDate, sendTelegramMessage, sendTelegramPhoto, SPORT_LABEL_KO, buildPostUrl, escapeHtml } from './telegram-common.js';

// 신규 분석글 알림에 함께 보낼 이미지
const NOTICE_IMAGE_URL = '/image/new-up.png';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function getNewMdFiles(beforeHash) {
  const output = execSync(
    `git diff --name-only --diff-filter=A ${beforeHash} HEAD -- src/content/posts/`,
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
    console.error('❌ 사용법: node notify-posts-telegram.js <이전 커밋 해시>');
    process.exit(1);
  }

  const files = getNewMdFiles(beforeHash);
  if (files.length === 0) {
    console.log('ℹ️ 새로 생성된 분석글이 없어 알림을 보내지 않습니다.');
    return;
  }

  // 날짜 > 종목 > 리그 3단 그룹핑
  // grouped['26.07.08']['야구']['MLB'] = ['<a...>팀A vs 팀B</a>', ...]
  const grouped = {};
  // 리그명 옆에 국가명을 붙이기 위한 매핑. 같은 리그는 항상 같은 국가라고 가정하고
  // 처음 등장한 글의 country 값을 기준으로 삼는다.
  const leagueCountry = {};

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const homeTeam = parseFrontmatterField(content, 'homeTeam');
    const awayTeam = parseFrontmatterField(content, 'awayTeam');
    const date = parseFrontmatterField(content, 'date');
    const category = parseFrontmatterField(content, 'category') || 'etc';
    const league = parseFrontmatterField(content, 'league') || ''; // 없으면 리그 소제목 생략
    const country = parseFrontmatterField(content, 'country') || '';
    const slug = parseFrontmatterField(content, 'slug');
    if (!homeTeam || !awayTeam) continue;

    const dateLabel = toShortDate(date);
    const sportLabel = SPORT_LABEL_KO[category] || category;

    if (!grouped[dateLabel]) grouped[dateLabel] = {};
    if (!grouped[dateLabel][sportLabel]) grouped[dateLabel][sportLabel] = {};
    if (!grouped[dateLabel][sportLabel][league]) grouped[dateLabel][sportLabel][league] = [];
    if (league && country && !leagueCountry[league]) leagueCountry[league] = country;

    // 날짜는 이미 상위 헤더로 빠졌으니 경기 줄에서는 제거
    const lineText = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
    const url = buildPostUrl(slug);
    grouped[dateLabel][sportLabel][league].push(url ? `<a href="${url}">${lineText}</a>` : lineText);
  }

  const dateLabels = Object.keys(grouped).sort(); // "YY.MM.DD" 문자열 정렬 = 날짜순 정렬
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
        // league 필드가 없던 글은 리그 소제목 없이 경기 목록만
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
  const sportSetCount = new Set(dateLabels.flatMap(d => Object.keys(grouped[d]))).size;

  const message = ['<b>📢 신규 분석글 업데이트</b>', '', body].join('\n');

  await sendTelegramPhoto(NOTICE_IMAGE_URL);
  await sendTelegramMessage(message);
  console.log(`✅ 신규 분석글 알림 발송 완료 (${total}건, ${dateLabels.length}개 날짜, ${sportSetCount}개 종목)`);
}

main();