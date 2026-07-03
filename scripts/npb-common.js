// scripts/npb-common.js
// NPB(일본프로야구) 공식 사이트의 "予告先発投手"(예고선발투수) 페이지를 스크래핑하는 모듈.
// 이 페이지는 완전 정적 HTML이라 AJAX 없이 fetch() 한 번으로 끝난다.
// 전날 발표되므로 매일 접속하면 "내일 경기" 예고선발이 이미 올라와 있는 구조.
//
// ⚠️ 비공식 스크래핑이므로 NPB가 HTML 구조를 바꾸면 파서가 깨질 수 있음.
//    balanced-div 방식으로 파싱해서 내부 마크업이 약간 바뀌어도 어느 정도 견고하게 만들었음.

const BASE = 'https://npb.jp';
const STARTER_URL = `${BASE}/announcement/starter/`;

// team_name_map.js의 NPB 섹션(영문 키) ↔ NPB.jp가 alt 텍스트로 주는 일본어 팀명
export const NPB_TEAM_NAME_MAP = {
  'Chiba Lotte Marines': '千葉ロッテマリーンズ',
  'Chunichi Dragons': '中日ドラゴンズ',
  'Fukuoka S. Hawks': '福岡ソフトバンクホークス',
  'Hanshin Tigers': '阪神タイガース',
  'Hiroshima Carp': '広島東洋カープ',
  'Nippon Ham Fighters': '北海道日本ハムファイターズ',
  'Orix Buffaloes': 'オリックス・バファローズ',
  'Rakuten Gold. Eagles': '東北楽天ゴールデンイーグルス',
  'Seibu Lions': '埼玉西武ライオンズ',
  'Yakult Swallows': '東京ヤクルトスワローズ',
  'Yokohama BayStars': '横浜DeNAベイスターズ',
  'Yomiuri Giants': '読売ジャイアンツ',
};

// games: parseStarterAnnouncements().games
// homeTeamEn/awayTeamEn: database/{date}.json의 match.home / match.away (영문 원문)
export function findNpbGame(games, homeTeamEn, awayTeamEn) {
  const homeJp = NPB_TEAM_NAME_MAP[homeTeamEn];
  const awayJp = NPB_TEAM_NAME_MAP[awayTeamEn];
  if (!homeJp || !awayJp) return null;

  return games.find(g => g.home?.teamName === homeJp && g.away?.teamName === awayJp)
    // 혹시 홈/원정이 뒤바뀐 데이터가 들어올 경우 대비한 역방향도 확인
    || games.find(g => g.home?.teamName === awayJp && g.away?.teamName === homeJp)
    || null;
}

// ─────────────────────────────────────────────
// 영어 이름 + 시즌 성적(ERA/승패) 조회 (npb.jp/eng/)
// npb.jp/eng/에는 予告先発投手(예고선발) 공지 페이지 자체가 없어서(영어 사이트엔
// 일정/공지 섹션이 없고 stats/teams/players만 있음) 페이지 자체를 영어판으로 통째로
// 바꿀 수는 없고, 대신 이미 확보한 pitcherId로 선수 개인 페이지(영어판)를 별도 조회해서
// 로마자 이름 + 연도별 성적표에서 올해 행을 뽑아 쓰는 방식으로 우회함.
// 예: https://npb.jp/bis/eng/players/51055132.html
//     <title>Takahashi,Keiji（Tokyo Yakult Swallows） | Players ...</title>
//     연도별 투구 성적표: Year | Team | G | W | L | ... | ERA(항상 마지막 컬럼)
// 주의: raw HTML 태그 구조를 직접 확인 못하고 만든 파서라, 실사용 테스트로 검증 필요.
// ─────────────────────────────────────────────
async function fetchEnglishPlayerStats(playerId) {
  if (!playerId) return null;
  try {
    const res = await fetch(`${BASE}/bis/eng/players/${playerId}.html`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();

    // 이름 추출
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let name = null;
    if (titleMatch) {
      const rawName = titleMatch[1].split(/[（|]/)[0].trim();
      if (rawName) {
        const [last, first] = rawName.split(',').map(s => s.trim());
        name = (last && first) ? `${first} ${last}` : rawName;
      }
    }

    // "Pitching Stats" 표에서 올해(YYYY) 행을 찾아 W/L/ERA 추출
    let era = null, wins = null, losses = null;
    try {
      const currentYear = String(new Date().getFullYear());
      const pitchingSectionMatch = html.match(/Pitching Stats([\s\S]*?)(Batting Stats|$)/i);
      const section = pitchingSectionMatch ? pitchingSectionMatch[1] : html;

      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(section))) {
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
        }
        if (cells.length > 4 && cells[0] === currentYear) {
          // 헤더 순서: Year, Team, G, W, L, ... , ERA(마지막 컬럼 고정)
          wins = cells[3] || null;
          losses = cells[4] || null;
          era = cells[cells.length - 1] || null;
          break;
        }
      }
    } catch {
      // 성적표 파싱 실패해도 이름은 살리고 성적만 비움 (방어적 처리)
    }

    return { name, era, wins, losses };
  } catch {
    return null; // 실패하면 호출부에서 일본어 이름으로 폴백
  }
}

// ─────────────────────────────────────────────
// HTML 조회
// ─────────────────────────────────────────────
export async function fetchStarterAnnouncementHtml() {
  const res = await fetch(STARTER_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`예고선발 페이지 호출 실패: HTTP ${res.status}`);
  return await res.text();
}

// ─────────────────────────────────────────────
// HTML 조회
// ─────────────────────────────────────────────
export async function fetchStarterAnnouncementHtml() {
  const res = await fetch(STARTER_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`예고선발 페이지 호출 실패: HTTP ${res.status}`);
  return await res.text();
}

// ─────────────────────────────────────────────
// <div class="unit xx_N">...</div> 블록을 balanced-div 방식으로 추출.
// 정규식만으로는 중첩된 </div>를 정확히 못 끊어내서, 태그를 순회하며 depth를 센다.
// ─────────────────────────────────────────────
function extractUnitBlocks(html) {
  const blocks = [];
  const startRegex = /<div class="unit\s+([a-z0-9_]+)"/gi;
  let match;
  while ((match = startRegex.exec(html))) {
    const start = match.index;
    const leagueClass = match[1]; // 예: cl_1, pl_2

    const tagRe = /<div\b[^>]*>|<\/div>/gi;
    tagRe.lastIndex = start;
    let depth = 0;
    let end = -1;
    let m;
    while ((m = tagRe.exec(html))) {
      if (m[0].toLowerCase() === '</div>') {
        depth--;
        if (depth === 0) { end = tagRe.lastIndex; break; }
      } else {
        depth++;
      }
    }

    if (end !== -1) {
      blocks.push({ leagueClass, html: html.slice(start, end) });
      startRegex.lastIndex = end;
    } else {
      // 안전장치: 닫는 태그를 못 찾으면 무한루프 방지 위해 한 칸 전진
      startRegex.lastIndex = start + 1;
    }
  }
  return blocks;
}

// team_left / team_right 안의 팀명(alt), 투수 ID, 투수명을 추출
function extractTeamSide(blockHtml, side) {
  const sideRe = new RegExp(`<div class="${side}">([\\s\\S]*?)<\\/div>`, 'i');
  const sideMatch = blockHtml.match(sideRe);
  if (!sideMatch) return null;
  const inner = sideMatch[1];

  const nameMatch = inner.match(/alt="([^"]+)"/);
  const idMatch = inner.match(/players\/(\d+)\.html/);
  const pitcherMatch = inner.match(/<span>([^<]+)<\/span>/);

  return {
    teamName: nameMatch ? nameMatch[1] : null,
    pitcherId: idMatch ? idMatch[1] : null,
    pitcherName: pitcherMatch ? pitcherMatch[1].trim() : null,
  };
}

// photo_left(홈) / photo_right(원정) 프로필 사진 URL 추출. 프로토콜 없는 //로 시작하면 https: 붙여줌.
function extractPhotoUrl(blockHtml, side) {
  const re = new RegExp(`<img src="([^"]+)"\\s+class="${side}"`, 'i');
  const m = blockHtml.match(re);
  if (!m) return null;
  return m[1].startsWith('//') ? `https:${m[1]}` : m[1];
}

// <div class="info"> (구장) 시간 </div> 파싱
function extractInfo(blockHtml) {
  const infoMatch = blockHtml.match(/<div class="info">([\s\S]*?)<\/div>/i);
  if (!infoMatch) return { venue: null, time: null };
  const text = infoMatch[1];
  const venueMatch = text.match(/[（(]([^）)]+)[）)]/);
  const timeMatch = text.match(/(\d{1,2}:\d{2})/);
  return {
    venue: venueMatch ? venueMatch[1].trim() : null,
    time: timeMatch ? timeMatch[1] : null,
  };
}

// ─────────────────────────────────────────────
// 메인 파서: HTML → 경기별 { league, home, away, venue, time } 배열
// team_left = 홈팀, team_right = 원정팀 (구장이 team_left 쪽 팀의 홈구장인 것으로 실측 확인함)
// ─────────────────────────────────────────────
export function parseStarterAnnouncements(html) {
  const dateMatch = html.match(/<h4>([^<]*予告先発投手)<\/h4>/);
  const announcedForText = dateMatch ? dateMatch[1] : null; // 예: "7月3日の予告先発投手"

  const blocks = extractUnitBlocks(html);
  const games = blocks.map(({ leagueClass, html: blockHtml }) => {
    const home = extractTeamSide(blockHtml, 'team_left');
    const away = extractTeamSide(blockHtml, 'team_right');
    if (home) home.photoUrl = extractPhotoUrl(blockHtml, 'photo_left');
    if (away) away.photoUrl = extractPhotoUrl(blockHtml, 'photo_right');
    const { venue, time } = extractInfo(blockHtml);
    const league = leagueClass.startsWith('cl') ? 'central'
                 : leagueClass.startsWith('pl') ? 'pacific'
                 : null;
    return { league, home, away, venue, time };
  });

  return { announcedForText, games };
}

export async function fetchStarterAnnouncements() {
  const html = await fetchStarterAnnouncementHtml();
  const parsed = parseStarterAnnouncements(html);

  // 경기별 홈/원정 선발투수의 영어(로마자) 이름 + 시즌 성적(ERA/승패)을 병렬로 조회해서 추가.
  // 조회 실패 시 각 필드는 null로 남고, 호출부(fetch-npb-context.js/npb-lineup-update.js)가
  // 일본어 이름(pitcherName) 또는 이름만 있는 형태로 폴백 처리한다.
  await Promise.all(
    parsed.games.map(async (g) => {
      if (g.home) {
        const stats = await fetchEnglishPlayerStats(g.home.pitcherId);
        g.home.pitcherNameEn = stats?.name || null;
        g.home.pitcherEra = stats?.era || null;
        g.home.pitcherWins = stats?.wins || null;
        g.home.pitcherLosses = stats?.losses || null;
      }
      if (g.away) {
        const stats = await fetchEnglishPlayerStats(g.away.pitcherId);
        g.away.pitcherNameEn = stats?.name || null;
        g.away.pitcherEra = stats?.era || null;
        g.away.pitcherWins = stats?.wins || null;
        g.away.pitcherLosses = stats?.losses || null;
      }
    })
  );

  return parsed;
}

// "7月3日の予告先発投手" 같은 텍스트에서 연도 없는 월/일만 뽑아 'YYYY-MM-DD'로 변환.
// 연도는 기준일(refDate) 기준으로 추정 (12월→1월로 넘어가는 연말 경계만 +1년 처리).
export function parseAnnouncedDate(announcedForText, refDate = new Date()) {
  if (!announcedForText) return null;
  const m = announcedForText.match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = refDate.getFullYear();
  if (refDate.getMonth() === 11 && month === 1) year += 1; // 12월 기준일에 1월 발표면 다음 해
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// match.date(UTC ISO 문자열) → KST 기준 'YYYY-MM-DD'
export function toKstDateStr(isoDateStr) {
  const kst = new Date(new Date(isoDateStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}