// Activity (no mockup yet; product.md §6.11): everything that was created, changed, deployed, backed up or deleted,
// and who did it, newest first, filtered by kind of resource. Data: GET /activity?kind=&limit=.
import { pageHead, chips, card } from '/ui/js/components/index.js';
import { html, errorCard, isAbort, reloadable } from '../lib.js';
import { activityFeed } from '../components/index.js';

const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'account', label: 'Accounts' },
  { value: 'vm', label: 'VMs' },
  { value: 'app', label: 'Apps' },
  { value: 'database', label: 'Databases' },
  { value: 'bucket', label: 'Buckets' },
];

export async function render(view, { query, ctx }) {
  let kind = KINDS.some((k) => k.value === query.get('kind')) ? query.get('kind') : 'all';
  const redraw = await reloadable(view, ctx, async () => {
    let activity;
    try {
      ({ activity } = await ctx.api.get('activity', { query: { limit: 200, kind: kind === 'all' ? undefined : kind } }));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the activity'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    // Keep focus on the chip that was pressed: the redraw replaces it.
    const pressed = view.ownerDocument?.activeElement?.closest?.('[data-kind]')?.dataset.kind;
    view.innerHTML = String(html`${pageHead({ title: 'Activity', lead: 'Everything that was created, changed, deployed, backed up or deleted, and who did it.' })}
      ${chips({ label: 'Show', name: 'kind', items: KINDS, current: kind, small: true })}
      ${card({ label: 'Activity', body: activityFeed(activity, { empty: kind === 'all' ? 'Nothing has happened yet.' : 'Nothing of this kind yet.' }) })}`);
    if (pressed) view.querySelector(`[data-kind="${pressed}"]`)?.focus();
    return 0;
  });
  view.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-kind]');
    if (!chip || chip.dataset.kind === kind) return;
    kind = chip.dataset.kind;
    redraw();
  }, { signal: ctx.signal });
}
