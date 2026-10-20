// VM detail (infra-vm-detail/VMDetail.dc.html; product.md §6.4). Built in roadmap phase 2.
import { placeholder } from '../lib.js';

export async function render(view, { params, ctx }) {
  placeholder(view, ctx, {
    trail: [['Virtual machines', '/vms'], [params.name]],
    title: params.name,
    phase: 2,
    what: 'Health, HTTPS endpoints, the apps on this VM, its details (IPs, SSH, ports, cost) and the latest deploy.',
  });
}
