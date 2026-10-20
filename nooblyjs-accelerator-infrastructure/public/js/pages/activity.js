// Activity (no mockup yet; product.md §6.11). Built in roadmap phase 1.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    title: 'Activity',
    lead: 'Everything that was created, changed, deployed, backed up or deleted, and who did it.',
    phase: 1,
    what: 'The full history, filtered by kind of resource and by person.',
  });
}
