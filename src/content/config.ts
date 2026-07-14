import { defineCollection, z } from 'astro:content';

/**
 * 'posts' 컬렉션 설정
 * 마크다운 파일의 프론트매터(상단 설정값)를 안전하게 파싱하기 위한 스키마 정의입니다.
 */
const postsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    // 필수 필드
    title: z.string(),
    date: z.union([z.date(), z.string()]),
    description: z.string().optional(),
    slug: z.string(),
    category: z.string(),
    country: z.string().default('국가'),
    league: z.string().default('리그'),
    homeTeam: z.string().default('홈팀'),
    awayTeam: z.string().default('원정팀'),
    homeLogo: z.string().optional().default('/images/wing-home.png'),
    awayLogo: z.string().optional().default('/images/wing-away.png'),
    homeAnalysis: z.string().optional(),
    awayAnalysis: z.string().optional(),
    homePower: z.string().optional(),
    awayPower: z.string().optional(),
    h2h: z.string().optional(),
    summary: z.string().optional(),
    homeRecent: z.string().optional(),
    awayRecent: z.string().optional(),
    injuryHome: z.string().optional(),
    injuryAway: z.string().optional(),
    pickWinTeam: z.string().optional(),
    pickWinResult: z.string().optional(),
    pickHandicapTeam: z.string().optional(),
    pickHandicapValue: z.string().optional(),
    pickOuDirection: z.string().optional(),
    pickOuValue: z.string().optional(),
  }).passthrough(),  // ← 이 줄 추가
});

/**
 * 'sponsors' 컬렉션 설정
 * 후원업체 목록/상세 페이지(/sponsors)에서 사용합니다.
 * 이미지는 posts와 동일하게 문자열 경로 방식(/images/...)을 사용합니다.
 * → public/sponsors/ 폴더에 이미지를 넣고 그 경로를 적으면 됩니다.
 * 후원사가 0곳이어도, 이미지가 없어도 빌드가 깨지지 않도록
 * logo/banner에도 기본 이미지를 default로 넣어뒀습니다.
 */
const sponsorsCollection = defineCollection({
  type: 'content', // 상세내용은 .md 파일 본문(Markdown)으로 작성
  schema: z.object({
    // ── 목록/상세 공통 ──────────────────────────────
    name: z.string(),              // 후원사명 (예: 삼성전자)
    url: z.string(),               // https://samsung.com
    urlLabel: z.string().optional(), // 목록 카드에 보여줄 짧은 도메인 텍스트 (없으면 url에서 자동 추출)
    logo: z.string().optional().default('/images/sponsor-default-logo.png'),  // 흰 박스 안에 들어가는 로고 이미지
    banner: z.string().optional().default('/images/sponsor-default-banner.png'), // 목록 카드 상단 배너 이미지

    // ── 상세페이지 전용 ─────────────────────────────
    eventName: z.string().optional(),        // 이벤트명
    eventAmount: z.number().optional(),      // 총 이벤트 금액 (숫자만, 표시할 때 콤마 자동 처리)
    eventProducts: z.array(z.string()).optional(), // 이벤트 제품 태그들 (갤럭시, 세탁기, 노트북...)
    ongoingEvent: z.string().optional(),     // 진행중이벤트 텍스트
    adImage: z.string().optional(),          // 상세내용 안에 들어가는 제휴사 광고 이미지

    // ── 노출/정렬 ───────────────────────────────────
    order: z.number().default(0),  // 낮을수록 먼저 노출
    active: z.boolean().default(true), // false면 목록/상세 모두에서 숨김 (계약 종료 시 사용)
  }),
});

/**
 * 정의된 컬렉션을 export 합니다.
 * 이제 리스트 페이지([...page].astro)의 getCollection('posts')에서 
 * 위 스키마를 기준으로 데이터를 안전하게 불러올 수 있습니다.
 */
export const collections = {
  'posts': postsCollection,
  'sponsors': sponsorsCollection,
};
