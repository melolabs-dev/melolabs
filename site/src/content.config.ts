import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    lang: z.enum(['pt', 'en']),
    date: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
    summary: z.string().optional(),
    status: z.string().optional(),
  }),
});

export const collections = { posts };
