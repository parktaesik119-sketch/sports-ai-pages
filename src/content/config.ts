import { defineCollection, z } from 'astro:content';

// 공통 스키마
const baseSchema = z.object({
  title: z.string(),
  date: z.string().or(z.date()),
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
  schema: baseSchema,
});

/* 🔥 여기 추가 */
const notice = defineCollection({
  type: 'content',
  schema: baseSchema,
});

export const collections = {
  posts,
  free,
  partners,
  notice, // 🔥 이거 반드시 추가
};