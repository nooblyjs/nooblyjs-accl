// Cloud accounts (no mockup yet; product.md §6.11): the GCP projects and AWS accounts Noobly Cloud works in, whether
// each is connected, and connecting a new one. Only an Owner (change-guardrails) connects or removes. Data:
// GET /accounts, GET /about (which providers this install uses), GET /catalog?cloud= (regions for the form).
// Git connections join this page in roadmap phase 6.
import { pageHead, notice, statusPill, dataTable, card } from '/ui/js/components/index.js';
import { ago } from '/ui/js/format.js';
import { html, button, errorCard, isAbort, reloadable, say, messageRegion, REFRESH_MS } from '../lib.js';
import { cloudBadge, confirmDialog } from '../components/index.js';
import { resourceNameProblem } from '../shared/names.js';

const CLOUDS = [
  { id: 'gcp', label: 'Google Cloud', idField: 'projectId', idLabel: 'Project ID', idHelp: 'The GCP project to work in, e.g. stevie-prod.', credentials: 'Service account key (JSON)', credentialsHelp: 'A key for a service account with the Compute Admin, Cloud SQL Admin and Storage Admin roles on the project.' },
  { id: 'aws', label: 'Amazon Web Services', idField: 'accountId', idLabel: 'Account ID', idHelp: 'The 12-digit AWS account ID.', credentials: 'Role ARN and external ID', credentialsHelp: 'The ARN of a role Noobly Cloud may assume, and its external ID, one per line. Access keys work too.' },
];

const field = (name, label, control, help) => html`<div class="inf-field"><label class="inf-field__label" for="inf-acc-${name}">${label}</label>${control}${help ? html`<span class="inf-help" id="inf-acc-${name}-help">${help}</span>` : ''}<span class="inf-error" data-error="${name}" id="inf-acc-${name}-error" aria-live="polite"></span></div>`;

function form(catalogs) {
  return html`<form class="card inf-form" data-form="connect" novalidate aria-labelledby="inf-connect-h">
    <h2 class="card__title" id="inf-connect-h">Connect a cloud account</h2>
    <fieldset class="inf-choice"><legend class="inf-field__label">Cloud</legend>
      ${CLOUDS.map((c, i) => html`<label class="inf-option"><input type="radio" name="cloud" value="${c.id}"${i === 0 ? html` checked` : ''}>${cloudBadge(c.id)}<span>${c.label}</span></label>`)}
    </fieldset>
    <span class="inf-error" data-error="cloud" aria-live="polite"></span>
    <div class="inf-form__row">
      ${field('name', 'Name', html`<input class="inf-input inf-mono" id="inf-acc-name" name="name" required autocomplete="off" spellcheck="false" aria-describedby="inf-acc-name-help inf-acc-name-error">`, 'What Noobly Cloud calls it. Lower-case letters, numbers and dashes.')}
      ${CLOUDS.map((c, i) => html`<div data-cloud="${c.id}"${i ? html` hidden` : ''}>${field(c.idField, c.idLabel, html`<input class="inf-input inf-mono" id="inf-acc-${c.idField}" name="${c.idField}" autocomplete="off" spellcheck="false" aria-describedby="inf-acc-${c.idField}-help inf-acc-${c.idField}-error"${c.id === 'aws' ? html` inputmode="numeric"` : ''}${i ? html` disabled` : ''}>`, c.idHelp)}</div>`)}
    </div>
    ${CLOUDS.map((c, i) => html`<div data-cloud="${c.id}"${i ? html` hidden` : ''}>
      ${field(`defaultRegion-${c.id}`, 'Default region', html`<select class="inf-input" id="inf-acc-defaultRegion-${c.id}" name="defaultRegion" aria-describedby="inf-acc-defaultRegion-${c.id}-error"${i ? html` disabled` : ''}>${(catalogs[c.id]?.regions ?? []).map((r) => html`<option value="${r.id}">${r.id} · ${r.label}</option>`)}</select>`)}
      ${field(`credentials-${c.id}`, c.credentials, html`<textarea class="inf-input inf-mono" id="inf-acc-credentials-${c.id}" name="credentials" rows="5" spellcheck="false" autocomplete="off" aria-describedby="inf-acc-credentials-${c.id}-help inf-acc-credentials-${c.id}-error"${i ? html` disabled` : ''}></textarea>`, c.credentialsHelp)}
    </div>`)}
    <span class="inf-error" data-error="provider" aria-live="polite"></span>
    <div class="actions">${button({ label: 'Connect', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'connect-close' } })}</div>
  </form>`;
}

function accountsTable(accounts, ctx) {
  const canChange = ctx.can('change-guardrails');
  const canCheck = ctx.can('draft');
  return dataTable({
    caption: 'Cloud accounts',
    empty: 'No cloud accounts yet.',
    rows: accounts,
    columns: [
      { key: 'name', label: 'Account', render: (a) => html`<span class="inf-inline">${cloudBadge(a.cloud)}<span><strong>${a.label}</strong><span class="inf-sub">${a.cloud === 'gcp' ? `Project ${a.projectId}` : `Account ${a.accountId}`} · ${a.providerLabel}</span></span></span>` },
      { key: 'region', label: 'Default region', render: (a) => a.regionLabel },
      { key: 'state', label: 'Status', render: (a) => html`${statusPill({ text: a.stateText, tone: a.stateTone })}${a.stateMessage ? html`<span class="inf-sub">${a.stateMessage}</span>` : ''}` },
      { key: 'checked', label: 'Last checked', render: (a) => (a.checkedAt ? html`<time datetime="${a.checkedAt}">${ago(a.checkedAt)}</time>` : '—') },
      { key: 'resources', label: 'Resources', numeric: true, render: (a) => String(a.resources?.total ?? 0) },
      {
        key: 'actions',
        label: html`<span class="visually-hidden">Actions</span>`,
        render: (a) => html`<span class="inf-actions">${canCheck ? button({ label: 'Check now', kind: 'secondary', small: true, attrs: { 'data-action': 'check', 'data-id': a.id } }) : ''}${canChange ? button({ label: 'Remove', kind: 'secondary', small: true, attrs: { 'data-action': 'remove', 'data-id': a.id } }) : ''}</span>`,
      },
    ],
  });
}

export async function render(view, { ctx }) {
  const canChange = ctx.can('change-guardrails');
  let about = { providers: [] };
  const catalogs = {};
  try {
    about = await ctx.api.get('about');
  } catch (err) {
    if (isAbort(err)) return;
  }
  const mockOnly = about.providers?.length && about.providers.every((p) => p === 'mock');

  view.innerHTML = String(html`${pageHead({
    title: 'Cloud accounts',
    lead: 'The GCP projects and AWS accounts Noobly Cloud works in.',
    actions: canChange ? button({ label: 'Connect account', icon: 'plus', attrs: { 'data-action': 'connect-open' } }) : '',
  })}
    ${messageRegion()}
    ${mockOnly ? notice({ title: 'Running on the mock cloud', text: 'This install uses the mock cloud: connecting an account creates nothing in Google Cloud or AWS. The GCP and AWS providers arrive in roadmap phase 2.', tone: 'muted', iconName: 'info' }) : ''}
    <div data-region="form" hidden></div>
    <div data-region="list"></div>`);
  const list = view.querySelector('[data-region="list"]');
  const formRegion = view.querySelector('[data-region="form"]');

  const redraw = await reloadable(list, ctx, async () => {
    let accounts;
    try {
      ({ accounts } = await ctx.api.get('accounts'));
    } catch (err) {
      if (!isAbort(err)) list.innerHTML = String(errorCard(err, 'the cloud accounts'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    list.innerHTML = String(card({ label: 'Cloud accounts', body: accountsTable(accounts, ctx) }));
    return accounts.some((a) => a.state === 'connecting') ? REFRESH_MS : 0;
  });

  const showErrors = (fields = {}) => {
    for (const el of formRegion.querySelectorAll('[data-error]')) el.textContent = '';
    for (const el of formRegion.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const [name, text] of Object.entries(fields)) {
      const cloud = formRegion.querySelector('input[name="cloud"]:checked')?.value;
      const target = formRegion.querySelector(`[data-error="${name}"]`) ?? formRegion.querySelector(`[data-error="${name}-${cloud}"]`);
      if (target) target.textContent = text;
      formRegion.querySelector(`[name="${name}"]:not([disabled])`)?.setAttribute('aria-invalid', 'true');
    }
    formRegion.querySelector('[aria-invalid="true"]')?.focus();
  };

  async function openForm() {
    try {
      for (const c of CLOUDS) catalogs[c.id] ??= await ctx.api.get('catalog', { query: { cloud: c.id } });
    } catch (err) {
      if (!isAbort(err)) say(view, `Couldn't load the regions: ${err.message}`, 'error');
      return;
    }
    formRegion.innerHTML = String(form(catalogs));
    formRegion.hidden = false;
    formRegion.querySelector('input[name="name"]').focus();
  }

  view.addEventListener('change', (event) => {
    if (event.target.name !== 'cloud') return;
    for (const block of formRegion.querySelectorAll('[data-cloud]')) {
      const on = block.dataset.cloud === event.target.value;
      block.hidden = !on;
      for (const control of block.querySelectorAll('input, select, textarea')) control.disabled = !on;
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    if (event.target.dataset.form !== 'connect') return;
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    const problem = resourceNameProblem(body.name);
    if (problem) return showErrors({ name: problem });
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { account } = await ctx.api.post('accounts', body);
      formRegion.hidden = true;
      formRegion.replaceChildren();
      say(view, `Connecting ${account.label}. This takes a minute.`, 'success');
      await redraw();
    } catch (err) {
      if (isAbort(err)) return;
      if (err.details?.fields) showErrors(err.details.fields);
      else say(view, err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }, { signal: ctx.signal });

  view.addEventListener('click', async (event) => {
    const target = event.target.closest?.('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'connect-open') return openForm();
    if (action === 'connect-close') {
      formRegion.hidden = true;
      formRegion.replaceChildren();
      return undefined;
    }
    try {
      if (action === 'check') {
        target.disabled = true;
        const account = await ctx.api.post(`accounts/${encodeURIComponent(id)}/verify`);
        say(view, `${account.label}: ${account.stateText}${account.stateMessage ? ` — ${account.stateMessage}` : ''}.`, account.state === 'connected' ? 'success' : 'error');
      }
      if (action === 'remove') {
        const ok = await confirmDialog(view, {
          title: `Remove ${id}?`,
          text: 'Noobly Cloud forgets this account and its credentials. Nothing in the cloud is deleted. An account that still has resources here can’t be removed.',
          confirmLabel: 'Remove account',
          typeToConfirm: id,
        });
        if (!ok) return undefined;
        await ctx.api.del(`accounts/${encodeURIComponent(id)}`, { body: { confirm: id } });
        say(view, `Removed ${id}.`, 'success');
      }
      await redraw();
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    } finally {
      target.disabled = false;
    }
    return undefined;
  }, { signal: ctx.signal });
}
