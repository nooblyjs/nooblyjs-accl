// Virtual machines (infra-virtual-machines/VirtualMachines.dc.html; product.md §6.2). Built in roadmap phase 2.
import { placeholder, button, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    title: 'Virtual machines',
    lead: 'Linux VMs across GCP and AWS.',
    actions: button({ label: 'Launch VM', icon: 'plus', href: hrefFor(ctx, '/vms/new') }),
    phase: 2,
    what: 'Every VM with its cloud and zone, size, status, public IP, endpoint and estimated monthly cost, filtered by cloud and searchable by name, IP or domain.',
  });
}
