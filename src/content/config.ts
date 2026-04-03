import { defineCollection, z } from 'astro:content';

// 공통 스키마 (🔥 slug 추가됨)
const baseSchema = z.object({
  title: z.string(),
  date: z.string().or(z.date()),
  slug: z.string().optional(), // ✅ 핵심
});

// 게시판들
const posts = defineCollection({
  type: 'content',
  schema: baseSchema,
});

const free = defineCollection({
  type: 'content',
  schema: baseSchema,
});

const partners = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(), // 👉 date 없는 구조 유지
  }),
});

const notice = defineCollection({
  type: 'content',
  schema: baseSchema,
});

export const collections = {
  posts,
  free,
  partners,
  notice,
};