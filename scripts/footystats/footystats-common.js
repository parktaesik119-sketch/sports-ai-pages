// scripts/footystats/footystats-common.js
// footystats.org는 API가 없고 서버사이드 렌더링된 HTML을 그대로 내려주는 사이트다
// (2026-07 실사용 브라우저 조사로 확인). GitHub Actions IP는 Cloudflare가 차단하지만
// 집 IP(HOME_PROXY_URL 경유)로는 챌린지 없이 그대로 통과되는 것도 확인함.
//
// ⚠️ 전제조건: 이 파일의 모든 함수는 HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가
// 반드시 있어야 동작한다 (footystats.org는 GitHub Actions IP에서 직접 호출하면 403).
//
// 필요 패키지: npm install cheerio

import * as cheerio from 'cheerio';

// ─────────────────────────────────────────────
// 엄격한 팀명 매칭. 기존 matchTeam()(espn-common.js)은 "포함되면 매칭"이라
// "England"가 "New England Revolution"에 포함되는 식으로 전혀 다른 팀이 걸리는
// 문제가 실사용에서 확인됨(노르웨이-잉글랜드 국가대표전이 MLS 클럽으로 잘못 매칭됨 등).
//
// 단순히 "후보 이름에 검색어 단어가 몇 개나 더 있냐"로는 안 된다 — "Progreso"가
// "Club Atletico Progreso"(정상 매칭)에 붙는 것과 "England"가
// "New England Revolution"(오매칭)에 붙는 게 단어 개수상으로는 구분이 안 되기 때문.
// 그래서 "클럽 이름에 흔히 붙는 범용 수식어" 화이트리스트를 만들어서, 후보 이름의
// 여분 단어가 전부 이 화이트리스트 안에 있을 때만 매칭을 인정한다.
// ─────────────────────────────────────────────
const IGNORABLE_CLUB_WORDS = new Set([
  'FC', 'CF', 'SC', 'AFC', 'CD', 'AC', 'CLUB',
  'DEPORTIVO', 'ATLETICO', 'ATLÉTICO', 'SOCIAL', 'SPORTING', 'ASOCIACION', 'ASOCIACIÓN',
  'DE', 'Y', 'DA', 'DO', 'DOS', 'LOS', 'EL', 'LA',
]);

function normalizeToWordSet(name) {
  return new Set(
    (name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // 악센트 분리(é→e+´) 후 악센트 부호만 제거
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

export function strictTeamMatch(candidateName, searchName) {
  const candWords = normalizeToWordSet(candidateName);
  const searchWords = normalizeToWordSet(searchName);
  if (candWords.size === 0 || searchWords.size === 0) return false;

  // 검색어의 단어는 (화이트리스트 제외하고) 전부 후보 이름 안에 있어야 한다.
  for (const w of searchWords) {
    if (IGNORABLE_CLUB_WORDS.has(w)) continue;
    if (!candWords.has(w)) return false;
  }

  // 후보 이름에만 있는 "여분 단어"는 전부 화이트리스트에 있는 것만 허용한다.
  // (Club Atletico Progreso처럼 정식 명칭 접두어는 통과, New England Revolution처럼
  //  전혀 다른 정체성의 단어가 섞여 있으면 차단)
  for (const w of candWords) {
    if (searchWords.has(w)) continue;
    if (!IGNORABLE_CLUB_WORDS.has(w)) return false;
  }

  return true;
}

const HOME_PROXY_URL = (process.env.HOME_PROXY_URL || '').trim();
const HOME_PROXY_SECRET = (process.env.HOME_PROXY_SECRET || '').trim();

function assertProxyConfigured() {
  if (!HOME_PROXY_URL || !HOME_PROXY_SECRET) {
    throw new Error('HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 필요합니다 (footystats.org는 집 IP 경유 필수)');
  }
}

// footystats.org가 짧은 시간에 요청이 몰리면 429(속도 제한)로 막는 것을 실사용
// 테스트로 확인함 — 모든 요청 사이에 최소한의 간격을 둔다.
// (0.8초로 뒀을 때도 간헐적으로 빈 응답이 오는 사례가 있어 1.5초로 늘림 — 2026-07 확인)
const REQUEST_DELAY_MS = 1500;
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function proxyFetchOnce(targetUrl, { method = 'GET', body = null, headers = {} } = {}) {
  const proxiedUrl = `${HOME_PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxiedUrl, {
    method,
    headers: { 'X-Proxy-Secret': HOME_PROXY_SECRET, ...headers },
    body,
  });
  const upstreamStatus = res.headers.get('x-upstream-status');
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`프록시 요청 실패: HTTP ${res.status} | ${text.slice(0, 200)}`);
  }
  if (upstreamStatus && upstreamStatus !== '200') {
    throw new Error(`footystats.org 응답 실패: HTTP ${upstreamStatus} | ${text.slice(0, 200)}`);
  }
  return text;
}

async function proxyFetch(targetUrl, options = {}) {
  assertProxyConfigured();
  await delay(REQUEST_DELAY_MS);
  const text = await proxyFetchOnce(targetUrl, options);

  // ⚠️ HTTP 200인데 본문이 텅 빈 간헐적 케이스가 관찰됨(2026-07) — 명확한 에러는
  // 아니라서 위 에러 처리로는 안 걸러지지만, 실제로는 실패한 요청이다.
  // 한 번 더 기다렸다가 재시도해서 자동 복구를 시도한다.
  if (text.length === 0) {
    console.log(`   ⚠️ 빈 응답 감지, 재시도: ${targetUrl}`);
    await delay(REQUEST_DELAY_MS * 2);
    return proxyFetchOnce(targetUrl, options);
  }

  return text;
}

async function getHtml(url) {
  return proxyFetch(url, { method: 'GET' });
}

// ─────────────────────────────────────────────
// 1. 팀 검색: POST /search.php (body: searchString={query})
// ─────────────────────────────────────────────
export async function searchClub(query) {
  const html = await proxyFetch('https://footystats.org/search.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `searchString=${encodeURIComponent(query)}`,
  });

  const $ = cheerio.load(html);
  const results = [];
  $('li > a.cf').each((_, el) => {
    const href = $(el).attr('href'); // 예: /clubs/manchester-united-fc-149
    const name = $(el).find('.name').text().trim();
    if (href && href.startsWith('/clubs/')) {
      results.push({ name, path: href });
    }
  });

  // ⚠️ 진단용: 검색 결과가 0건이면, 실제로 응답이 어떻게 왔는지 로그로 남긴다.
  // (파싱 셀렉터가 틀렸는지, 프록시가 이상한 응답을 돌려줬는지, 진짜 검색 결과가
  // 없는 건지 다음 실행 로그에서 구분할 수 있게 함)
  if (results.length === 0) {
    console.log(`   🔎 [진단] "${query}" 검색 결과 0건 — 응답 길이 ${html.length}자, 앞부분: ${html.slice(0, 300).replace(/\s+/g, ' ')}`);
  }

  return results;
}

// ─────────────────────────────────────────────
// 2. 클럽 페이지: 최근 경기(완료분) + 스쿼드(선수+포지션+사진)
//    GET /clubs/{slug} (한글(/kr/) 아님 — 영문 페이지 기준으로 파싱해야 팀명이
//    team_name_map.js와 매칭하기 쉽다)
// ─────────────────────────────────────────────
export async function getClubPage(clubPath) {
  const url = clubPath.startsWith('http') ? clubPath : `https://footystats.org${clubPath}`;
  const html = await getHtml(url);
  return cheerio.load(html);
}

// $ = getClubPage()가 반환한 cheerio 인스턴스
export function parseClubRecentMatches($, limit = 10) {
  const matches = [];
  $('li.matchHistoryEvent').each((_, el) => {
    const li = $(el);
    // 클래스에 'incomplete'가 있으면 아직 안 끝난(예정) 경기라 제외
    if ((li.attr('class') || '').includes('incomplete')) return;

    const home = li.find('.homeTeamInfo p').first().text().trim();
    const away = li.find('.awayTeamInfo p').first().text().trim();
    const scoreText = li.find('.scoreline span').first().text().trim(); // "3 - 0"
    const isoDate = li.find("meta[itemprop='startDate']").attr('content'); // 2026-07-03T18:45:00+00:00

    const scoreParts = scoreText.split('-').map(s => s.trim());
    const homeScore = scoreParts[0] !== undefined ? parseInt(scoreParts[0], 10) : null;
    const awayScore = scoreParts[1] !== undefined ? parseInt(scoreParts[1], 10) : null;

    if (!home || !away || Number.isNaN(homeScore) || Number.isNaN(awayScore)) return;

    matches.push({
      date: isoDate ? isoDate.slice(0, 10) : null,
      home,
      away,
      homeScore,
      awayScore,
    });
  });

  // 최신순 정렬(날짜 문자열 비교로 충분 - ISO 형식) 후 상위 N개만
  return matches
    .filter(m => m.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

// $ = getClubPage()가 반환한 cheerio 인스턴스
export function parseClubSquad($) {
  const VALID_POSITIONS = new Set(['GK', 'DF', 'MF', 'FW']);
  const players = [];
  const seen = new Set(); // profilePath 기준 중복 제거

  $("a.semi-bold[href^='/players/']").each((_, el) => {
    const a = $(el);
    const href = a.attr('href'); // /players/{country}/{name-slug}
    const name = a.text().trim();
    const parts = href.split('/').filter(Boolean); // ['players', country, slug]
    const country = parts[1];
    const slug = parts[2];

    // 같은 행(div.w94.rw100.cf.m0Auto) 안의 두 번째 <p>가 포지션(GK/DF/MF/FW)
    const row = a.closest('p').parent(); // <p class="col-lg-6 ellipses">의 부모 div
    const position = row.find('p').eq(1).text().trim();

    // ⚠️ 스쿼드 표(전체 선수 명단) 말고도 페이지 다른 곳(득점자 순위 등)에
    // 같은 클래스(a.semi-bold)의 선수 링크가 또 나와서 이름 뒤에 숫자가 붙은
    // 중복 항목("Stefan Mugoša  7" 등, position 없음)이 섞이는 걸 실사용 테스트로 확인함.
    // 포지션이 GK/DF/MF/FW 중 하나로 정확히 확인된 것만 스쿼드로 인정한다.
    if (!VALID_POSITIONS.has(position)) return;
    if (seen.has(href)) return; // 같은 선수가 여러 번 잡히는 것도 방지
    seen.add(href);

    if (name && href) {
      players.push({
        name,
        position,
        profilePath: href,
        photoUrl: country && slug ? `https://cdn.footystats.org/img/players/${country}-${slug}.png` : null,
      });
    }
  });

  // ⚠️ 진단용: 선수를 하나도 못 찾았으면, 파싱 셀렉터가 안 맞는 건지 이 클럽 페이지
  // 자체에 스쿼드 정보가 없는 건지 구분할 수 있게 페이지 제목/일부를 남긴다.
  if (players.length === 0) {
    const title = $('title').text().trim();
    const bodySnippet = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`   🔎 [진단] 스쿼드 0명 — 페이지 제목: "${title}" | 본문 일부: ${bodySnippet}`);
  }

  return players;
}

// ─────────────────────────────────────────────
// 3. H2H 페이지: GET /{country-slug}/{team1}-vs-{team2}-h2h-stats
//    아그리게이트 요약 + 개별 경기 리스트(최대 수십 경기)
// ─────────────────────────────────────────────
// H2H 페이지를 딱 한 번만 가져온다(매치 목록과 라인업이 같은 페이지 안에 다 있어서
// 따로따로 요청할 필요가 없음 — 실사용 테스트로 확인).
export async function getH2hPage(countrySlug, team1Slug, team2Slug) {
  const url = `https://footystats.org/${countrySlug}/${stripClubIdSuffix(team1Slug)}-vs-${stripClubIdSuffix(team2Slug)}-h2h-stats`;
  try {
    const html = await getHtml(url);
    return cheerio.load(html);
  } catch (err) {
    // ⚠️ 진단용: 301 등으로 실패하면 실제로 어떤 URL을 시도했는지(특히 countrySlug 값)
    // 남겨서 다음 실행 로그에서 URL 조립 자체가 잘못된 건지 바로 확인 가능하게 한다.
    throw new Error(`${err.message} | 시도한 URL: ${url} (countrySlug="${countrySlug}")`);
  }
}

// $ = getH2hPage()가 반환한 cheerio 인스턴스
export function parseH2hMatches($, limit = 10) {
  const matches = [];
  $('a.fixture.changeH2HDataButton_neo').each((_, el) => {
    const a = $(el);
    const isoDate = a.find('time').attr('datetime');
    const teamDivs = a.find('.team');
    if (teamDivs.length < 2) return;

    function parseTeamDiv(div) {
      const span = div.find('span').first();
      const scoreText = span.text().trim();
      const score = scoreText === '' ? null : parseInt(scoreText, 10);
      const name = div.clone().children('span').remove().end().text().trim();
      return { name, score: Number.isNaN(score) ? null : score };
    }

    const t1 = parseTeamDiv(teamDivs.eq(0));
    const t2 = parseTeamDiv(teamDivs.eq(1));

    if (t1.score === null || t2.score === null) return; // 아직 안 열린(예정) 경기는 제외

    matches.push({
      date: isoDate ? isoDate.slice(0, 10) : null,
      home: t1.name,
      away: t2.name,
      homeScore: t1.score,
      awayScore: t2.score,
    });
  });

  return matches
    .filter(m => m.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

// 하위 호환용 - 예전처럼 한 번에 fetch + parse를 같이 하고 싶을 때.
// (라인업까지 같이 필요하면 getH2hPage() + parseH2hMatches()/parseMatchLineups()를
// 따로 써서 페이지를 한 번만 가져오는 쪽이 요청 수를 아낄 수 있음)
export async function getH2H(countrySlug, team1Slug, team2Slug, limit = 10) {
  const $ = await getH2hPage(countrySlug, team1Slug, team2Slug);
  return parseH2hMatches($, limit);
}

// ─────────────────────────────────────────────
// $ = getH2hPage()가 반환한 cheerio 인스턴스에서 "다음 경기" 실제 일시를 추출한다.
// 이 페이지의 schema.org 구조화 데이터(<span itemprop='startDate'>)에 ISO 일시가
// 그대로 박혀있는 걸 실사용 테스트로 확인함(2026-07). fm.date(분석글의 실제 경기 일시)와
// 비교해서, 날짜가 안 맞으면 팀이 잘못 매칭된 걸로 간주할 수 있다 —
// "Nacional"(우루과이) vs "CD Nacional"(포르투갈)처럼 이름만으로는 도저히 구분 안 되는
// 케이스도 날짜가 안 맞으면 걸러낼 수 있어서 팀명 매칭보다 훨씬 강력한 안전장치다.
export function parseUpcomingFixtureDate($) {
  const iso = $("span[itemprop='startDate']").first().attr('content');
  return iso || null;
}

// footystats가 준 일시(ISO)와 분석글의 실제 경기 일시(ISO)가 대략 맞는지 확인.
// 타임존 표기 차이 등을 감안해서 여유를 넉넉히(기본 48시간) 둔다 — 정확한 시각 일치가
// 아니라 "완전히 다른 경기/팀으로 잘못 매칭된 건 아닌지"를 걸러내는 용도이기 때문.
// ⚠️ 처음엔 48시간으로 뒀었는데, 실사용 로그에서 팀 매칭은 정확한데도 대량으로
// 걸러지는 문제를 발견함(2026-07) — 워크플로우가 실제 경기 종료 "이후"에 도는 경우가
// 많아서, footystats의 "다음 맞대결" 필드가 이미 지나간 이 경기가 아니라 두 팀의
// 그 다음번 맞대결(같은 시즌 내 리버스 픽스처 등, 보통 몇 주~몇 달 뒤)을 가리키게
// 되기 때문. 팀은 정확히 맞았는데 순수 타이밍 문제로 정상 데이터를 버리고 있었음.
// 완전히 다른 나라의 동명 클럽(예: 우루과이 Nacional vs 포르투갈 Nacional)까지
// 걸러내는 용도이기도 해서 무한정 늘리진 않고, 한 시즌 내 리그 일정을 넉넉히
// 커버할 수 있는 220일(약 7개월)로 크게 늘린다.
export function isDateReasonablyClose(isoA, isoB, toleranceDays = 220) {
  if (!isoA || !isoB) return false;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= toleranceDays * 24 * 60 * 60 * 1000;
}


// H2H 페이지 안에 있는 "Lineup Predictions & Injuries" 섹션 — 두 팀의 최근 사용
// 선발 11명(등번호/이름/세부포지션)을 뽑는다. ⚠️ "가장 최근에 사용된 라인업"
// 기준이지, 이번 경기 확정/공식 라인업이 아니다(footystats 페이지 자체 문구로 확인).
// $ = getH2hPage()가 반환한 cheerio 인스턴스
export function parseMatchLineups($) {
  // "#Starting 11" 헤더가 팀당 하나씩(총 2개), 그 바로 뒤에 "#Substitutes" 헤더가 옴.
  // [팀1-Starting11, 팀1-Substitutes, 팀2-Starting11, 팀2-Substitutes] 순서.
  const headers = $('.club-blue-highlight').toArray();
  const startingHeaders = headers.filter(h => $(h).text().includes('Starting 11'));
  if (startingHeaders.length < 2) return null; // 라인업 섹션 자체가 없는 경기(하위 리그 등)

  const allRows = $('.row.cf.m0Auto').toArray();

  // cheerio에는 DOM의 compareDocumentPosition이 없어서, 전체 노드 배열에서의
  // 인덱스 순서로 "헤더 A와 B 사이에 있는 행"을 판단한다.
  const allNodesInOrder = $('*').toArray();
  const indexOf = (el) => allNodesInOrder.indexOf(el);

  function rowsBetween(startEl, endEl) {
    const startIdx = indexOf(startEl);
    const endIdx = endEl ? indexOf(endEl) : Infinity;
    return allRows.filter(r => {
      const idx = indexOf(r);
      return idx > startIdx && idx < endIdx;
    });
  }

  function extractPlayers(rows) {
    const players = [];
    for (const r of rows) {
      const ps = $(r).children('p').toArray();
      if (ps.length < 3) continue;
      const a = $(ps[1]).find('a').first();
      const href = a.attr('href');
      const name = a.text().trim();
      const position = $(ps[2]).text().trim();
      const number = $(ps[0]).text().trim();
      if (!name || !href) continue;

      const parts = href.split('/').filter(Boolean); // ['players', country, slug]
      const country = parts[1];
      const slug = parts[2];

      players.push({
        number: number || null,
        name,
        position: position || null,
        profilePath: href,
        photoUrl: country && slug ? `https://cdn.footystats.org/img/players/${country}-${slug}.png` : null,
      });
    }
    return players;
  }

  function nextHeaderAfter(headerEl) {
    const pos = headers.indexOf(headerEl);
    return headers[pos + 1] || null;
  }

  const homeStarting = extractPlayers(rowsBetween(startingHeaders[0], nextHeaderAfter(startingHeaders[0])));
  const awayStarting = extractPlayers(rowsBetween(startingHeaders[1], nextHeaderAfter(startingHeaders[1])));

  if (homeStarting.length === 0 && awayStarting.length === 0) return null;

  // ⚠️ footystats는 HTML에서 선수를 "Forwards → Midfielders → Defenders → Goalkeeper"
  // 순서(공격수부터)로 나열한다(실사용 조사로 확인). 근데 _slug_.astro의 피치뷰 좌표 생성기는
  // 배열 순서를 GK→수비→미드필더→공격 순으로 기대해서(좌표를 그 순서로 만들어놓고 배열
  // 인덱스로 매칭하기 때문), 순서를 안 맞추면 공격수가 골키퍼 자리에 그려지는 식으로
  // 완전히 어긋난다. 그래서 반환하기 전에 항상 GK→DF→MF→FW 순서로 재정렬한다.
  return {
    home: sortForPitchView(homeStarting),
    away: sortForPitchView(awayStarting),
  };
}

// GK→DF→MF→FW 순서로 정렬. 분류 안 되는 포지션(예: "-")은 미드필더 취급해서 중간에 둔다
// (완전히 엉뚱한 자리보다는 중간이 그나마 덜 어색함).
function sortForPitchView(players) {
  const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  function bucketOf(pos) {
    const upper = (pos || '').toUpperCase().trim();
    if (upper === 'GK') return 'GK';
    if (DF_POSITIONS.has(upper)) return 'DF';
    if (FW_POSITIONS.has(upper)) return 'FW';
    return 'MF'; // MF_POSITIONS에 맞는 것도, 분류 안 되는 것도 전부 여기로
  }
  return [...players].sort((a, b) => order[bucketOf(a.position)] - order[bucketOf(b.position)]);
}

// 라인업(parseMatchLineups 결과의 home 또는 away)을 _slug_.astro가 기대하는
// "{이름} ({포지션})|{사진URL}" 문자열 배열로 변환. (kbo-lineup-update.js 등과 동일 포맷)
export function formatLineupForDisplay(players) {
  if (!players || players.length === 0) return [];
  return players.map(p => {
    const base = `${p.name} (${p.position || 'MF'})`;
    return p.photoUrl ? `${base}|${p.photoUrl}` : base;
  });
}

// ─────────────────────────────────────────────
// footystats는 UEFA/SofaScore와 달리 "4-2-3-1" 같은 포메이션 문자열을 직접 주지
// 않는다(실사용 조사로 확인) — 대신 선수별 세부 포지션 코드(CB/CDM/CF 등)는 있어서,
// 이 코드들을 세어서 "DF-MF-FW" 형태로 유추한다. 다른 소스(UEFA/SofaScore/ESPN)가
// 이미 주는 formation 문자열과 정확히 같은 포맷("4-3-3" 등, 세그먼트 3개)이라
// homeFormation/awayFormation 필드에 그대로 섞어 써도 된다.
//
// 분류 기준(실사용 테스트로 검증):
// - DF: CB, LB, RB, WB, LWB, RWB
// - MF: CDM, CAM, CM, DM, AM
// - FW: CF, ST, LF, RF, LW, RW  ← 윙어(LW/RW)는 미드필더가 아니라 공격진으로 분류.
//   (실제 스크린샷 두 건을 손으로 검산해서 이 분류가 "윙어=미드필더"보다 훨씬
//   자연스러운 포메이션이 나오는 것으로 확인함 — 후자로 하면 서로 다른 두 팀이
//   전부 4-5-1로 뭉뚱그려지는 등 부자연스러운 결과가 나왔음)
// GK는 정확히 1명이어야 하고, 나머지 10명이 전부 DF/MF/FW 중 하나로 분류되며
// DF/FW가 둘 다 0보다 커야만 신뢰할 수 있는 것으로 보고 결과를 낸다.
// 이 조건을 못 채우면(포지션 코드 누락 등) null을 반환해서 억지로 틀린 값을
// 만들어내지 않는다.
// ─────────────────────────────────────────────
const DF_POSITIONS = new Set(['CB', 'LB', 'RB', 'WB', 'LWB', 'RWB', 'DF']);
const MF_POSITIONS = new Set(['CDM', 'CAM', 'CM', 'DM', 'AM', 'MF', 'LM', 'RM']);
const FW_POSITIONS = new Set(['CF', 'ST', 'LF', 'RF', 'LW', 'RW', 'FW']);

export function deriveFormationFromLineup(players) {
  if (!players || players.length === 0) return null;

  let gk = 0, df = 0, mf = 0, fw = 0, unknown = 0;
  for (const p of players) {
    const pos = (p.position || '').toUpperCase().trim();
    if (pos === 'GK') gk++;
    else if (DF_POSITIONS.has(pos)) df++;
    else if (MF_POSITIONS.has(pos)) mf++;
    else if (FW_POSITIONS.has(pos)) fw++;
    else unknown++;
  }

  if (gk !== 1) return null;              // GK가 정확히 1명이 아니면 데이터 이상함
  // ⚠️ footystats가 일부 선수 포지션을 "-"(정보 없음)로 주는 경우가 실사용에서 확인됨
  // (11명 중 1명 정도는 흔함) — 그때마다 통째로 포기하면 너무 자주 실패하니, 최대 1명까지는
  // 무시하고 나머지로 계산한다. 2명 이상 미상이면 신뢰도가 너무 떨어져서 포기한다.
  if (unknown > 1) return null;
  // sortForPitchView()도 미분류 포지션을 미드필더 취급해서 정렬하므로, 여기서도 mf에
  // 합산해야 배열 길이(11명)와 포메이션 숫자 합이 어긋나지 않는다.
  mf += unknown;
  if (df + mf + fw < 9) return null;      // 분류된 필드 플레이어가 너무 적으면 불완전한 라인업
  if (df === 0 || fw === 0) return null;  // 수비/공격이 0명인 포메이션은 있을 수 없음

  // 미드필더가 5명 이상이면 한 줄에 몰아넣지 않고 두 줄(수비형/공격형)로 나눠서
  // "3-6-1" 대신 "3-3-3-1"처럼 훨씬 자연스러운 포메이션 모양을 만든다. footystats가
  // CDM/CAM처럼 세부 구분 없이 전부 "CM"으로 뭉뚱그려 줄 때가 많아서, "정확히 누가
  // 수비형이고 누가 공격형인지"까지는 알 수 없다 — 그래서 정렬된 순서 그대로 절반씩
  // 나눈다. 실제 배치와 100% 일치한다는 보장은 없지만, 한 줄에 5~6명이 몰려있는 것보다는
  // 훨씬 자연스러운 모양이 나온다. _slug_.astro의 좌표 생성기가 4구간 포메이션 문자열
  // ("4-2-3-1" 같은)을 이미 지원하므로 형식만 맞추면 별도 프론트 작업 없이 그려진다.
  if (mf >= 5) {
    const deeperMf = Math.floor(mf / 2);
    const advancedMf = mf - deeperMf;
    return `${df}-${deeperMf}-${advancedMf}-${fw}`;
  }

  return `${df}-${mf}-${fw}`;
}

// clubPath("/clubs/galway-united-fc-2052")에서 country/team 슬러그를 뽑아내는 헬퍼.
// H2H URL은 country-slug가 필요한데 이건 클럽 페이지의 국가 링크에서 가져와야 한다
// (clubPath 자체엔 국가 정보가 없음).
export function extractTeamSlugFromClubPath(clubPath) {
  // /clubs/galway-united-fc-2052 → galway-united-fc-2052
  const m = clubPath.match(/\/clubs\/(.+)$/);
  return m ? m[1] : null;
}

// ⚠️ H2H URL(/{country}/{team1}-vs-{team2}-h2h-stats)에 쓰이는 팀 슬러그는
// 클럽 페이지 경로 끝에 붙는 숫자 ID가 빠진 형태다.
// 예: 클럽 경로 slug "galway-united-fc-2052" → H2H에는 "galway-united-fc"만 사용.
// (실사용 테스트로 확인: 숫자 ID를 안 떼면 301 리다이렉트가 남 — 원인 특정 완료)
export function stripClubIdSuffix(slug) {
  if (!slug) return slug;
  return slug.replace(/-\d+$/, '');
}

// $ = getClubPage()가 반환한 cheerio 인스턴스에서 국가 슬러그 추출.
// 페이지 상단 브레드크럼(.breadcrumb)의 첫 번째 링크가 이 클럽의 국가/리그 최상위 경로다.
// (실사용 테스트로 확인: .breadcrumb 안의 링크 = ["/republic-of-ireland", "/clubs/galway-united-fc-2052"])
export function parseCountrySlug($) {
  const href = $('.breadcrumb a').first().attr('href'); // 예: /republic-of-ireland
  if (!href) return null;
  return href.split('/').filter(Boolean)[0] || null;
}

// ─────────────────────────────────────────────
// _slug_.astro가 실제로 렌더링하는 정확한 스키마로 변환.
// (직접 _slug_.astro 소스를 확인해서 맞춘 스키마 — 2026-07-11 확인)
//
// h2h:               { date, home, away, score, link? }              (result 없음)
// homeRecent/awayRecent: { date, home, away, score, result, link? }  (result: 🟢승/🔴패/🟡무)
//
// footystats matches({date:"2026-07-03", home, away, homeScore, awayScore})를
// 위 스키마로 변환한다. link는 footystats 매치엔 사이트 내부 글이 없으므로 항상 생략.
// ─────────────────────────────────────────────

// "2026-07-03" → "26.07.03" (기존 AI가 쓰던 날짜 표기와 동일하게 맞춤)
function toShortDate(isoDate) {
  const parts = (isoDate || '').split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
}

function computeResultEmoji(perspectiveIsHome, homeScore, awayScore) {
  const mine = perspectiveIsHome ? homeScore : awayScore;
  const opp  = perspectiveIsHome ? awayScore : homeScore;
  if (mine > opp) return '🟢승';
  if (mine < opp) return '🔴패';
  return '🟡무';
}

// h2h 필드용 변환 (result 없음)
export function toH2hDisplayFormat(matches) {
  return matches.map(m => ({
    date: toShortDate(m.date),
    home: m.home,
    away: m.away,
    score: `${m.homeScore}-${m.awayScore}`,
  }));
}

// homeRecent/awayRecent 필드용 변환. perspectiveNameKo는 "이 목록이 누구 기준인지"
// (homeRecent면 홈팀의 한글명, awayRecent면 원정팀의 한글명) — m.home과 문자열이
// 일치하면 그 경기에서 이 팀이 홈이었다고 보고 result를 계산한다.
export function toRecentDisplayFormat(matches, perspectiveNameKo) {
  return matches.map(m => {
    const perspectiveIsHome = m.home === perspectiveNameKo;
    return {
      date: toShortDate(m.date),
      home: m.home,
      away: m.away,
      score: `${m.homeScore}-${m.awayScore}`,
      result: computeResultEmoji(perspectiveIsHome, m.homeScore, m.awayScore),
    };
  });
}