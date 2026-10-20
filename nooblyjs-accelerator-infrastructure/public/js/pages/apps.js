// Apps (infra-apps/Apps.dc.html; product.md §6.5). Built in roadmap phase 6.
import { placeholder, button, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    title: 'Apps',
    lead: 'Apps built from Dockerfiles in Git and run on your VMs.',
    actions: button({ label: 'Deploy from Git', icon: 'plus', href: hrefFor(ctx, '/apps/new') }),
    phase: 6,
    what: 'Every app with its source, the VM it runs on, its endpoint, status and last deploy.',
  });
}
