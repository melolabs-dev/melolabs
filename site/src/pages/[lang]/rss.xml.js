import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export function getStaticPaths() {
  return [{ params: { lang: 'pt' } }, { params: { lang: 'en' } }];
}

export async function GET(context) {
  const lang = context.params.lang;
  const posts = (await getCollection('posts', (p) => p.data.lang === lang)).sort(
    (a, b) => (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0),
  );
  return rss({
    title: 'Melo Labs',
    description:
      lang === 'pt'
        ? 'Estudos práticos de cloud, arquitetura, engenharia de software e IA.'
        : 'Hands-on studies of cloud, architecture, software engineering and AI.',
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date ?? new Date(0),
      description: p.data.summary ?? '',
      link: `/${lang}/${p.id.split('/')[1]}/`,
    })),
  });
}
