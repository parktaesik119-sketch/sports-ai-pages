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
    
    // 날짜 데이터의 경우 마크다운 작성 방식에 따라 Date 객체나 String으로 인식될 수 있으므로 유연하게 대처
    date: z.union([z.date(), z.string()]),
    
    // 선택적 필드 및 기본값 설정
    description: z.string().optional(),
    slug: z.string(),
    category: z.string(),
    
    // 리스트 표기에 필요한 추가 데이터들
    country: z.string().default('국가'),
    league: z.string().default('리그'),
    homeTeam: z.string().default('홈팀'),
    awayTeam: z.string().default('원정팀'),
    
    // 로고 경로: 데이터가 없을 경우 기본 날개 로고 경로를 사용하도록 설정
    homeLogo: z.string().optional().default('/images/wing-home.png'),
    awayLogo: z.string().optional().default('/images/wing-away.png'),
  }),
});

/**
 * 정의된 컬렉션을 export 합니다.
 * 이제 리스트 페이지([...page].astro)의 getCollection('posts')에서 
 * 위 스키마를 기준으로 데이터를 안전하게 불러올 수 있습니다.
 */
export const collections = {
  'posts': postsCollection,
};