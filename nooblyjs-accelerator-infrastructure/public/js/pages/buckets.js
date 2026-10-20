// Buckets and the object browser (infra-buckets/Buckets.dc.html; product.md §6.9). /buckets/:name opens one.
// Built in roadmap phase 4.
import { placeholder, button, hrefFor } from '../lib.js';

export async function render(view, { params, ctx }) {
  placeholder(view, ctx, {
    ...(params.name ? { trail: [['Buckets', '/buckets'], [params.name]] } : {}),
    title: params.name ?? 'Buckets',
    lead: params.name ? undefined : 'Object storage on Cloud Storage and S3.',
    actions: params.name ? undefined : button({ label: 'Create bucket', icon: 'plus', href: hrefFor(ctx, '/buckets/new') }),
    phase: 4,
    what: 'Every bucket with its access, size, objects and cost, and a browser to upload, download, share and delete files.',
  });
}
