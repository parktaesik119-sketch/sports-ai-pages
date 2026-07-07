// scripts/telegram-common.js
// 두 알림 스크립트(notify-lineup-telegram.js, notify-posts-telegram.js)가 공통으로 쓰는 유틸

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