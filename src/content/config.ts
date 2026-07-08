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
 * 정의된 컬렉션을 export 합니다.
 * 이제 리스트 페이지([...page].astro)의 getCollection('posts')에서 
 * 위 스키마를 기준으로 데이터를 안전하게 불러올 수 있습니다.
 */
export const collections = {
  'posts': postsCollection,
};