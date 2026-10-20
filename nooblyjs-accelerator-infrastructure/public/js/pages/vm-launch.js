// Launch a Linux VM (infra-launch-a-vm/LaunchVM.dc.html; product.md §6.3). Built in roadmap phase 2.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    trail: [['Virtual machines', '/vms'], ['Launch']],
    title: 'Launch a Linux VM',
    lead: 'Pick a cloud and a size. You can put it on a public address now or later.',
    phase: 2,
    what: 'Cloud and region, machine, image and disk, access and a public endpoint, with a live summary and monthly estimate.',
  });
}
