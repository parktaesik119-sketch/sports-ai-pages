import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 도메인 주소는 정확히 유지하세요.
  site: 'https://pick79.com',
  integrations: [
    sitemap({
      // 구글 핑 대신 '수정 날짜'를 봇에게 명확히 전달합니다.
      serialize(item) {
        if (/posts\//.test(item.url)) {
          item.changefreq = 'hourly'; // 분석글은 자주 확인하도록 유도
          item.lastmod = new Date().toISOString(); // 현재 시간을 마지막 수정일로 기록
          item.priority = 0.9; // 일반 페이지보다 높은 우선순위 부여
        }
        return item;
      },
    }),
  ],
});