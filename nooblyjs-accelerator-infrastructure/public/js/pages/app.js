// App detail (no mockup yet; product.md §6.11). Built in roadmap phase 6.
import { placeholder } from '../lib.js';

export async function render(view, { params, ctx }) {
  placeholder(view, ctx, {
    trail: [['Apps', '/apps'], [params.name]],
    title: params.name,
    phase: 6,
    what: 'Source, where it runs, its endpoint, environment variables and every deploy with its log.',
  });
}
