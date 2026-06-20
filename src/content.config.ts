// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 🔵 분석글
const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
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
  }).passthrough(),
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
  notice,
};