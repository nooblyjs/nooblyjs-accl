// Databases (infra-databases/Databases.dc.html; product.md §6.7). /databases/:name selects one. Built in roadmap
// phase 5.
import { placeholder, button, hrefFor } from '../lib.js';

export async function render(view, { params, ctx }) {
  placeholder(view, ctx, {
    ...(params.name ? { trail: [['Databases', '/databases'], [params.name]] } : {}),
    title: params.name ?? 'Databases',
    lead: params.name ? undefined : 'Managed MySQL, and MongoDB on its own VM, backed up daily.',
    actions: params.name ? undefined : button({ label: 'Create database', icon: 'plus', href: hrefFor(ctx, '/databases/new') }),
    phase: 5,
    what: 'Every database with its engine, cloud, size and storage, and for the selected one how to connect, its backups, users and metrics.',
  });
}
