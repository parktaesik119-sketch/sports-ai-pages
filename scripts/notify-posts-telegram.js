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
import { parseFrontmatterField, toShortDate, sendTelegramMessage, SPORT_LABEL_KO } from './telegram-common.js';

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

  // 종목별로 그룹핑
  const grouped = {}; // { soccer: ["26.07.03 G팀 vs F팀", ...], ... }

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const homeTeam = parseFrontmatterField(content, 'homeTeam');
    const awayTeam = parseFrontmatterField(content, 'awayTeam');
    const date = parseFrontmatterField(content, 'date');
    const category = parseFrontmatterField(content, 'category') || 'etc';
    if (!homeTeam || !awayTeam) continue;

    const label = SPORT_LABEL_KO[category] || category;
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(`${toShortDate(date)} ${homeTeam} vs ${awayTeam}`);
  }

  const sections = Object.keys(grouped);
  if (sections.length === 0) {
    console.log('ℹ️ 팀 정보를 읽지 못해 알림을 보내지 않습니다.');
    return;
  }

  const body = sections
    .map(label => [label, ...grouped[label]].join('\n'))
    .join('\n\n');

  const message = ['<b>신규 분석글 업데이트</b>', '', body].join('\n');

  await sendTelegramMessage(message);
  const total = sections.reduce((sum, k) => sum + grouped[k].length, 0);
  console.log(`✅ 신규 분석글 알림 발송 완료 (${total}건, ${sections.length}개 종목)`);
}

main();
