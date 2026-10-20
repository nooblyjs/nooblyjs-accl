// Create a bucket (infra-create-a-bucket/CreateBucket.dc.html; product.md §6.10). Built in roadmap phase 4.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    trail: [['Buckets', '/buckets'], ['Create']],
    title: 'Create a bucket',
    lead: 'Object storage for uploads, media, exports and backups. You pay for what you store.',
    phase: 4,
    what: 'Name and location, storage class, access, and protection and clean-up, with the price per GB.',
  });
}
