// scripts/telegram-common.js
// 두 알림 스크립트(notify-lineup-telegram.js, notify-posts-telegram.js)가 공통으로 쓰는 유틸

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const SPORT_LABEL_KO = {
  soccer: '축구', baseball: '야구', basketball: '농구',
  volleyball: '배구', hockey: '하키', lol: 'LOL',
};

export function parseFrontmatterField(content, field) {
  const re = new RegExp(`^${field}:\\s*"([^"]*)"`, 'm');
  const match = content.match(re);
  return match ? match[1] : null;
}

// "2026-07-02T09:30:00+00:00" → "26.07.02"
export function toShortDate(isoDateStr) {
  if (!isoDateStr) return '';
  const d = new Date(isoDateStr);
  if (isNaN(d)) return '';
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
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
