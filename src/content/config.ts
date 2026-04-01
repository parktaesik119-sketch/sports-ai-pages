// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string().or(z.date()),
  }),
});

export const collections = {
  'posts': posts, // 여기서 설정한 이름 'posts'가 중요합니다.
};