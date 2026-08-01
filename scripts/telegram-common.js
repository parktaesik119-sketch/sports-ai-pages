// scripts/telegram-common.js
// 두 알림 스크립트(notify-lineup-telegram.js, notify-posts-telegram.js)가 공통으로 쓰는 유틸

import fs from 'fs';
import path from 'path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 분석글 상세 페이지 URL 베이스. frontmatter의 slug와 합쳐서 링크를 만든다.
const SITE_BASE_URL = 'https://pick79.com';

export function buildPostUrl(slug) {
  if (!slug) return null;
  return `${SITE_BASE_URL}/posts/detail/${slug}/`;
}

export const SPORT_LABEL_KO = {
  soccer: '축구', baseball: '야구', basketball: '농구',
  volleyball: '배구', hockey: '하키', lol: 'LOL',
};

export function parseFrontmatterField(content, field) {
  // 대부분 필드는 "값" 형태로 따옴표가 있지만, date 필드는 예외적으로
  // 따옴표 없이 저장됨 (예: date: 2026-07-03T09:00:00+00:00).
  // 따옴표 있는 값을 먼저 시도하고, 없으면 줄 끝까지를 값으로 취급.
  const quotedRe = new RegExp(`^${field}:\\s*"([^"]*)"`, 'm');
  const quotedMatch = content.match(quotedRe);
  if (quotedMatch) return quotedMatch[1];

  const bareRe = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm');
  const bareMatch = content.match(bareRe);
  return bareMatch ? bareMatch[1] : null;
}

// "2026-07-02T09:30:00+00:00" → "26.07.02" (KST, UTC+9 기준)
// GitHub Actions 러너는 UTC 타임존으로 돌아가기 때문에, 서버 로컬 시간대에
// 의존하지 않고 UTC 값에 9시간을 직접 더해서 KST 기준 날짜를 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function toShortDate(isoDateStr) {
  if (!isoDateStr) return '';
  const d = new Date(isoDateStr);
  if (isNaN(d)) return '';
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없어 알림을 건너뜁니다.');
    return false;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`텔레그램 전송 실패 HTTP ${res.status}: ${body}`);
  }
  return true;
}

// 텔레그램 텍스트 메시지 길이 제한 (sendMessage 기준)
export const TELEGRAM_TEXT_LIMIT = 4096;

// header + blocks(날짜별 블록처럼 그 자체로 완결된 문단들의 배열)를 하나의 메시지로 합쳐
// 우선 전송을 시도한다. 4096자 제한(ENTITIES_TOO_LONG)에 걸려 실패하면,
// 블록 단위로 나눠서 여러 메시지로 재전송한다. (블록 하나가 그 자체로도 너무 길면 줄 단위로 강제 분할)
export async function sendTelegramMessageWithBlocks(header, blocks) {
  const fullText = [header, '', blocks.join('\n\n\n')].join('\n');

  try {
    return await sendTelegramMessage(fullText);
  } catch (err) {
    const errMsg = String((err && err.message) || '');
    const isTooLong = errMsg.includes('ENTITIES_TOO_LONG') || errMsg.includes('MESSAGE_TOO_LONG');
    if (!isTooLong) throw err; // 글자수 문제가 아닌 다른 오류(네트워크, 인증 등)는 그대로 전파

    console.warn('⚠️ 메시지가 너무 길어(4096자 초과) 여러 개로 나눠서 재전송합니다.');
    const chunks = chunkBlocksByLimit(header, blocks);
    let allOk = true;
    for (const chunk of chunks) {
      const ok = await sendTelegramMessage(chunk);
      if (!ok) allOk = false;
    }
    return allOk;
  }
}

function chunkBlocksByLimit(header, blocks, limit = TELEGRAM_TEXT_LIMIT) {
  const chunks = [];
  let current = [];
  let currentLen = header.length + 2; // 헤더 + 빈 줄만큼의 기본 여유

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current);
    current = [];
    currentLen = header.length + 2;
  };

  for (const block of blocks) {
    const addLen = block.length + 3; // 블록 사이 구분자 '\n\n\n'

    if (current.length > 0 && currentLen + addLen > limit) {
      flush();
    }

    if (block.length + header.length + 2 > limit) {
      // 블록 하나가 그 자체로도 너무 긴 극단적인 경우: 줄 단위로 강제 분할
      flush();
      const lines = block.split('\n');
      let sub = [];
      let subLen = header.length + 2;
      for (const line of lines) {
        const lineLen = line.length + 1;
        if (sub.length > 0 && subLen + lineLen > limit) {
          chunks.push([sub.join('\n')]);
          sub = [];
          subLen = header.length + 2;
        }
        sub.push(line);
        subLen += lineLen;
      }
      if (sub.length) chunks.push([sub.join('\n')]);
      continue;
    }

    current.push(block);
    currentLen += addLen;
  }
  flush();

  const total = chunks.length;
  return chunks.map((blockGroup, i) => {
    const partHeader = total > 1 ? `${header} (${i + 1}/${total})` : header;
    return [partHeader, '', blockGroup.join('\n\n\n')].join('\n');
  });
}

// 캡션 없이 사진 한 장만 전송한다. (본문 텍스트는 뒤이어 sendTelegramMessage로 별도 발송)
// photoSource가 http(s):// 로 시작하면 URL 방식(텔레그램 서버가 직접 접근), 아니면
// 로컬 파일 경로로 간주해 실제 파일 바이너리를 multipart/form-data로 업로드한다.
export async function sendTelegramPhoto(photoSource) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없어 알림을 건너뜁니다.');
    return false;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const isUrl = /^https?:\/\//i.test(photoSource);

  let res;
  if (isUrl) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, photo: photoSource }),
    });
  } else {
    // 로컬 파일 경로: 실제 파일을 읽어서 바이너리로 업로드
    const fileBuffer = fs.readFileSync(photoSource);
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('photo', new Blob([fileBuffer]), path.basename(photoSource));
    res = await fetch(url, { method: 'POST', body: form });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`텔레그램 사진 전송 실패 HTTP ${res.status}: ${body}`);
  }
  return true;
}