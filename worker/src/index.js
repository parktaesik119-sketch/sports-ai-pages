// ─────────────────────────────────────────────────────────
// 스포츠 뉴스 게시판 - Cloudflare Worker
// - scheduled(): 30분마다 실행되는 크론. 네이버 API 호출 → 필터링 → KV 저장
// - fetch(): 프론트엔드가 호출하는 조회 API (GET /api/articles?sport=soccer)
// ─────────────────────────────────────────────────────────

// ── 종목별 검색어 (실측 테스트로 검증 완료) ──
const SPORTS_QUERIES = {
  soccer: ['K리그', '해외축구', '프리미어리그'],
  baseball: ['KBO', 'MLB 메이저리그'],
  basketball: ['KBL', 'NBA 농구'],
  volleyball: ['V리그 배구', '프로배구'],
  hockey: ['NHL', 'KHL', 'IIHF 아이스하키'],
  lol: ['리그오브레전드', 'LCK'],
};

// ── 종목별 노이즈 제외 키워드 ──
const EXCLUDE_KEYWORDS = {
  hockey: ['림프종', '백혈병', '치료제', '항체', '류마티스', '오리지널 의약품'],
  soccer: [],
  baseball: [],
  basketball: [],
  volleyball: [],
  lol: [],
};

// ── 특정 종목은 리그명이 정확히(대소문자 무관, 단어 단위) 일치할 때만 통과 ──
const REQUIRE_PATTERNS = {
  hockey: [/\bNHL\b/i, /\bKHL\b/i],
};

// ── iframe 삽입 가능 확인된 언론사 화이트리스트 ──
const ALLOWED_DOMAINS = [
  'osen.co.kr', 'sportschosun.com', 'mydaily.co.kr',
  'spotvnews.co.kr', 'isplus.com', 'news1.kr', 'newsis.com',
];

const SEED_LIMIT = 5;      // 최초 배포(콜드 스타트) 시 종목당 시드 기사 개수
const INDEX_MAX = 60;      // 종목별로 KV에 보관할 최대 기사 개수 (오래된 건 자동 정리)
const CALL_DELAY_MS = 300; // 네이버 API 연속 호출 사이 딜레이 (속도제한 방지, 실측으로 확인된 값)

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHighlightTags(text) {
  return text
    .replace(/<\/?b>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isAllowedSource(originallink) {
  return ALLOWED_DOMAINS.some(domain => originallink.includes(domain));
}

function isNoisy(sport, title, description) {
  const excludes = EXCLUDE_KEYWORDS[sport] || [];
  const combined = `${title} ${description}`;
  return excludes.some(keyword => combined.includes(keyword));
}

function matchesRequired(sport, title, description) {
  const patterns = REQUIRE_PATTERNS[sport];
  if (!patterns) return true;
  const combined = `${title} ${description}`;
  return patterns.some(p => p.test(combined));
}

function sourceDomain(originallink) {
  try {
    return new URL(originallink).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────
// 네이버 뉴스 검색 API
// ─────────────────────────────────────────────────────────

async function fetchNaverNews(query, env, display = 30) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`네이버 API HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.items || [];
}

async function collectSportArticles(sport, env) {
  const queries = SPORTS_QUERIES[sport];
  const allItems = [];

  for (const query of queries) {
    const items = await fetchNaverNews(query, env);
    allItems.push(...items);
    await sleep(CALL_DELAY_MS);
  }

  // 원문 링크 기준 중복 제거
  const seen = new Set();
  const deduped = allItems.filter(item => {
    if (seen.has(item.originallink)) return false;
    seen.add(item.originallink);
    return true;
  });

  // 화이트리스트 + 노이즈 필터 + 필수패턴 필터
  return deduped
    .filter(item => isAllowedSource(item.originallink))
    .map(item => ({
      title: stripHighlightTags(item.title),
      description: stripHighlightTags(item.description),
      originallink: item.originallink,
      pubDate: item.pubDate,
      source: sourceDomain(item.originallink),
    }))
    .filter(item => !isNoisy(sport, item.title, item.description))
    .filter(item => matchesRequired(sport, item.title, item.description));
}

// ─────────────────────────────────────────────────────────
// 크론: 종목별 수집 → KV 저장
// ─────────────────────────────────────────────────────────

async function processSport(sport, env) {
  const lastFetchKey = `meta:last_fetch:${sport}`;
  const indexKey = `index:${sport}`;

  const lastFetch = await env.NEWS_KV.get(lastFetchKey);
  const now = new Date().toISOString();

  const candidates = await collectSportArticles(sport, env);

  let newItems;
  if (!lastFetch) {
    // 최초 실행(콜드 스타트): 최신순 상위 N개만 시드
    newItems = candidates
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, SEED_LIMIT);
  } else {
    // 이후 실행: 마지막 실행 이후 발행된 것만
    newItems = candidates.filter(item => new Date(item.pubDate) > new Date(lastFetch));
  }

  if (newItems.length > 0) {
    // 기존 인덱스 불러와서 새 기사 앞에 붙이고, 링크 기준 중복 제거 후 개수 제한
    const existingRaw = await env.NEWS_KV.get(indexKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];

    const existingLinks = new Set(existing.map(a => a.originallink));
    const uniqueNew = newItems.filter(a => !existingLinks.has(a.originallink));

    const merged = [...uniqueNew, ...existing]
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, INDEX_MAX);

    await env.NEWS_KV.put(indexKey, JSON.stringify(merged));
  }

  await env.NEWS_KV.put(lastFetchKey, now);

  return { sport, found: candidates.length, added: newItems.length };
}

async function runCron(env) {
  const results = [];
  for (const sport of Object.keys(SPORTS_QUERIES)) {
    try {
      const result = await processSport(sport, env);
      results.push(result);
    } catch (err) {
      results.push({ sport, error: err.message });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────
// 조회 API: GET /api/articles?sport=soccer
// ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // 필요시 실제 도메인으로 제한 권장
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/articles') {
    const sport = url.searchParams.get('sport');

    if (sport && !SPORTS_QUERIES[sport]) {
      return jsonResponse({ error: `알 수 없는 종목: ${sport}` }, 400);
    }

    if (sport) {
      const raw = await env.NEWS_KV.get(`index:${sport}`);
      const articles = raw ? JSON.parse(raw) : [];
      return jsonResponse({ sport, articles });
    }

    // sport 파라미터 없으면 전체 종목 한 번에 반환
    const all = {};
    for (const s of Object.keys(SPORTS_QUERIES)) {
      const raw = await env.NEWS_KV.get(`index:${s}`);
      all[s] = raw ? JSON.parse(raw) : [];
    }
    return jsonResponse({ articles: all });
  }

  // 수동 트리거용 (테스트/디버그 목적, 운영에서는 접근 제한 권장)
  if (url.pathname === '/api/cron-trigger' && request.method === 'POST') {
    const results = await runCron(env);
    return jsonResponse({ results });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ─────────────────────────────────────────────────────────
// Worker 진입점
// ─────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    return handleApiRequest(request, env);
  },
};