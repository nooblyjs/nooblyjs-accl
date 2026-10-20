// Create a database (infra-create-a-database/CreateDatabase.dc.html; product.md §6.8). Built in roadmap phase 5.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    trail: [['Databases', '/databases'], ['Create']],
    title: 'Create a database',
    lead: 'Managed MySQL, or MongoDB on a VM we launch and look after. We handle patches, backups and passwords.',
    phase: 5,
    what: 'Engine, cloud and name, size and storage, and which VMs in the same cloud account can connect, with backups and a monthly estimate.',
  });
}
