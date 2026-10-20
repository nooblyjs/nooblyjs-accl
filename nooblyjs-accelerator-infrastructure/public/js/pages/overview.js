// Overview (infra-overview/Main.dc.html; product.md §6.1): totals, create tiles, HTTPS endpoints, recent activity and
// spend this month. Built in roadmap phase 1.11; until then it links to every screen.
import { placeholder, button, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    title: 'Infrastructure',
    lead: 'Your VMs, apps, databases and buckets on GCP and AWS, and what they cost.',
    actions: button({ label: 'Launch VM', icon: 'plus', href: hrefFor(ctx, '/vms/new') }),
    phase: 1,
    what: 'Totals for each kind of resource, public endpoints, recent activity and the estimated spend this month per cloud account.',
    links: [
      ['Launch a Linux VM', '/vms/new', 'Ubuntu or Debian on GCP or AWS, with a public endpoint'],
      ['Deploy from Git', '/apps/new', 'Build a repo’s Dockerfile and run it on one of your VMs'],
      ['Create a database', '/databases/new', 'Managed MySQL, or MongoDB on its own VM, with daily backups'],
      ['Create a bucket', '/buckets/new', 'Object storage for files, uploads and backups'],
      ['Cloud accounts', '/accounts', 'Connect GCP and AWS, and GitHub or GitLab'],
      ['Activity', '/activity', 'Everything that was created, changed, deployed or deleted'],
    ],
  });
}
