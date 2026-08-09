import { getCollection } from 'astro:content';

export async function GET() {
  const [posts, archived, notices] = await Promise.all([
    getCollection('posts'),
    getCollection('archive'),
    getCollection('notice'),
  ]);
  const allPosts = [...posts, ...archived];
  const site = "https://pick79.com";

  // 1. 하위 분석글 주소 목록 생성 (posts + archive 통합)
  const postUrls = allPosts.map((post) => {
    const slug = post.data.slug || (post as any).slug;

    return `
      <url>
        <loc>${site}/posts/detail/${slug}</loc>
        <lastmod>${new Date(post.data.date).toISOString()}</lastmod>
      </url>
    `;
  });

  // 2. 공지사항 주소 목록 생성
  const noticeUrls = notices.map((notice) => {
    const slug = notice.data.slug || notice.id;

    return `
      <url>
        <loc>${site}/notice/${slug}</loc>
        <lastmod>${new Date(notice.data.date).toISOString()}</lastmod>
      </url>
    `;
  });

  // 3. 맨 앞에 메인 주소(<url>)를 수동으로 결합합니다.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>${site}/</loc>
      <lastmod>${new Date().toISOString()}</lastmod>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>
    ${postUrls.join('')}
    ${noticeUrls.join('')}
  </urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}