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

// 🟣 후원업체
const sponsors = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/sponsors" }),
  schema: z.object({
    // ── 목록/상세 공통 ──────────────────────────────
    name: z.string(),              // 후원사명 (예: 삼성전자)
    slug: z.string().optional(),   // URL에 쓸 슬러그 (없으면 파일명 기준 id 사용)
    url: z.string(),               // https://samsung.com
    urlLabel: z.string().optional(), // 목록 카드에 보여줄 짧은 도메인 텍스트 (없으면 url에서 자동 추출)
    logo: z.string().optional().default('/images/sponsor-default-logo.png'),
    banner: z.string().optional().default('/images/sponsor-default-banner.png'),

    // ── 상세페이지 전용 ─────────────────────────────
    eventName: z.string().optional(),
    eventAmount: z.number().optional(),
    eventProducts: z.array(z.string()).optional(),
    ongoingEvent: z.string().optional(),
    adImage: z.string().optional(),

    // ── 노출/정렬 ───────────────────────────────────
    order: z.number().default(0),
    active: z.boolean().default(true),
  }),
});

export const collections = {
  posts,
  notice,
  sponsors,
};
