type Runtime = import('@astrojs/cloudflare').Runtime<{
  BLOG_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  BLOG_NAMESPACE: string;
  BLOG_PUBLISH_TOKEN: string;
  OPENROUTER_API_KEY: string;
  TOKENIZER_LIMIT: import('@cloudflare/workers-types').RateLimit;
  IMAGES: import('@cloudflare/workers-types').ImagesBinding;
}>;
declare namespace App {
  interface Locals extends Runtime {
    blogEntries?: Awaited<ReturnType<ReturnType<typeof import('./lib/blog/store.mjs').blogStore>['list']>>;
  }
}
