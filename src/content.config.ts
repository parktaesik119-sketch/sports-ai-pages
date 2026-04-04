// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 🔵 분석글 컬렉션
const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(), // 문자열이어도 날짜 객체로 변환해줌
    slug: z.string().optional(),
  }),
});

// 🔴 공지사항 컬렉션
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