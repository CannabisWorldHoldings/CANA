import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const privateSurfaces = [
    '/admin',
    '/business/dashboard',
    '/compare',
    '/customer',
    '/search',
    '/wallet',
  ];
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: privateSurfaces,
      },
      // Strategic AI-crawler policy (four-bot split): CITATION crawlers that
      // send readers are welcomed on authority content; TRAINING crawlers
      // that consume without attribution are declined. Rationale in
      // docs/research/research-synthesis.md.
      {
        userAgent: 'OAI-SearchBot',
        allow: ['/'],
        disallow: privateSurfaces,
      },
      {
        userAgent: 'PerplexityBot',
        allow: ['/'],
        disallow: privateSurfaces,
      },
      {
        userAgent: 'GPTBot',
        disallow: ['/'],
      },
      {
        userAgent: 'Google-Extended',
        disallow: ['/'],
      },
    ],
    sitemap: 'https://orderweeddc.com/sitemap.xml',
  };
}
