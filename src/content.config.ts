// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 🔵 분석글 스키마 (posts/archive 공용)
// archive는 posts와 완전히 같은 스키마를 쓴다 — 7일 지난 글을 폴더만 옮기는 것뿐이라
// 필드 구조가 달라질 이유가 없다.
const postSchema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  slug: z.string().optional(),

  /* 🔥 카테고리 제한 (중요) */
  category: z.enum([
    'soccer',
    'baseball',
    'basketball',
    'volleyball',
    'hockey',
    'lol'
  ]),

  /* ✅ 경기 정보 필드 추가 */
  country:  z.string().optional(),
  league:   z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  homeLogo: z.string().optional(),
  awayLogo: z.string().optional(),

  // 분석 데이터 추가
  description: z.string().optional(),
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
}).passthrough();

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: postSchema,
});

// 7일 지난 글이 옮겨가는 곳. 평소 30분마다 도는 빠른 빌드는 이 컬렉션을 건드리지
// 않고(BUILD_ARCHIVE 환경변수로 분기), 주 1회 도는 별도 빌드에서만 전체를 다시
// 만들어서 archive-dist 브랜치에 저장해둔다. src/pages/posts/detail/[slug].astro와
// scripts/archive-old-posts.js가 이 컬렉션을 함께 사용한다.
const archive = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/archive" }),
  schema: postSchema,
});

// 🔴 공지사항
const notice = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notice" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    slug: z.string().optional(),
  }),
});

export const collections = {
  posts,
  archive,
  notice,
};