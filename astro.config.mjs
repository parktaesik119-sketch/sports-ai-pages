import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pick79.com',

  // ✅ 슬래시 통일: 실제 URL이 슬래시로 끝나므로 always로 맞춤
  trailingSlash: 'always',

  markdown: {
    remarkPlugins: [],
    rehypePlugins: [],
  },

  integrations: [
    sitemap({
      serialize(item) {
        if (/posts\//.test(item.url)) {
          item.changefreq = 'daily'; // hourly는 과도함, daily로 충분
          // ✅ lastmod를 현재 시간으로 덮어쓰지 않음 (빌드마다 전체 갱신 방지)
          // Astro가 파일 수정일 기준으로 자동 처리하도록 그냥 둠
          item.priority = 0.9;
        }
        return item;
      },
    }),
  ],
});
