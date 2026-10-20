// Cloud accounts and Git connections (no mockup yet; product.md §6.11). Cloud accounts are built in roadmap phase 1,
// Git connections in phase 6.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    title: 'Cloud accounts',
    lead: 'The GCP projects and AWS accounts Noobly Cloud works in, and the Git hosts it deploys from.',
    phase: 1,
    what: 'Connect GCP and AWS, see whether each account is connected, and add GitHub or GitLab personal access tokens.',
  });
}
