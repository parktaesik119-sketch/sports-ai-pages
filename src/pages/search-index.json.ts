import { getCollection } from 'astro:content';

export async function GET() {
  const allPosts = await getCollection('posts');
  return new Response(JSON.stringify(allPosts), {
    headers: {
      'Content-Type': 'application/json',
      // 브라우저 캐시를 허용하여 매번 서버에서 다운로드하지 않고 빠르게 로딩되도록 설정
      'Cache-Control': 'public, max-age=3600'
    }
  });
}