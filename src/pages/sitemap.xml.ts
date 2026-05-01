import { getCollection } from 'astro:content';

export async function GET() {
  const posts = await getCollection('posts');

  const site = "https://pick79.com";

  const urls = posts.map((post) => {
    const slug = post.data.slug || (post as any).slug;

    return `
      <url>
        <loc>${site}/posts/detail/${slug}</loc>
        <lastmod>${new Date(post.data.date).toISOString()}</lastmod>
      </url>
    `;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls.join('')}
  </urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}