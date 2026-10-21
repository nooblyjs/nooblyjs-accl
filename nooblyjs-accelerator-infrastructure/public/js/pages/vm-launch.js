// Launch a Linux VM (infra-launch-a-vm/LaunchVM.dc.html; product.md §6.3): cloud and region, machine, image and disk,
// access, and (from roadmap phase 3) a public endpoint, with a summary that prices the choice as it is made — with the
// same estimate() the server uses. Data: GET /accounts, /catalog?cloud=, /ssh-keys, /my-ip. Sends POST /vms, then
// opens the new VM, which shows its launch.
import { pageHead, notice } from '/ui/js/components/index.js';
import { html, button, hrefFor, crumbs, errorCard, isAbort, say, messageRegion } from '../lib.js';
import { cloudBadge, formSection, field, describedBy, optionCards, switchRow, summary } from '../components/index.js';
import { formValues, showFieldErrors } from '../forms.js';
import { estimate, usd } from '../shared/estimate.js';
import { resourceNameProblem } from '../shared/names.js';

const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const NEW_KEY = '__new';

const options = (items, value) => items.map(([v, label]) => html`<option value="${v}"${v === value ? html` selected` : ''}>${label}</option>`);

export async function render(view, { ctx, query }) {
  view.innerHTML = String(html`${crumbs(ctx, [['Virtual machines', '/vms'], ['Launch']])}${pageHead({ title: 'Launch a Linux VM', lead: 'Pick a cloud and a size. You can put it on a public address now or later.' })}<div data-region="body"><p class="inf-muted">Loading…</p></div>`);
  const body = view.querySelector('[data-region="body"]');
  if (!ctx.can('draft')) {
    body.innerHTML = String(notice({ title: 'Launching a VM needs the draft permission', text: 'Ask an Owner to give you the Contributor role.', tone: 'muted' }));
    return;
  }

  let accounts;
  let keys;
  let myIp;
  const catalogs = {};
  try {
    [{ accounts }, { keys }, myIp] = await Promise.all([ctx.api.get('accounts'), ctx.api.get('ssh-keys'), ctx.api.get('my-ip')]);
    accounts = accounts.filter((a) => a.state === 'connected');
    for (const cloud of new Set(accounts.map((a) => a.cloud))) catalogs[cloud] = await ctx.api.get('catalog', { query: { cloud } });
  } catch (err) {
    if (!isAbort(err)) body.innerHTML = String(errorCard(err, 'what you can launch'));
    return;
  }
  if (!accounts.length) {
    body.innerHTML = String(notice({
      title: 'Connect a cloud account first',
      text: 'A VM is launched in one of your GCP projects or AWS accounts.',
      actions: button({ label: 'Cloud accounts', href: hrefFor(ctx, '/accounts') }),
    }));
    return;
  }

  // What the form starts with: the account asked for (?account=), else the first; its default region and zone.
  const first = accounts.find((a) => a.id === query.get('account')) ?? accounts[0];
  const state = { account: first.id, region: first.defaultRegion };
  const accountOf = () => accounts.find((a) => a.id === state.account);
  const catalogOf = () => catalogs[accountOf().cloud];
  const regionOf = () => catalogOf().regions.find((r) => r.id === state.region) ?? catalogOf().regions[0];

  const sizeCards = (cat, region, value) => optionCards({
    name: 'size',
    legend: 'Size',
    value,
    items: [
      ...SIZES.map(([id, title]) => {
        const type = cat.sizes[id];
        const m = cat.machineTypes[type];
        const e = estimate('vm', { region, machineType: type, diskGb: 0 }, cat);
        return { value: id, title, text: html`${m.vcpu} vCPU · ${m.memoryGb} GB<br>${type}`, price: `~${usd(e.monthly)} / mo` };
      }),
      { value: 'custom', title: 'Custom', text: 'Choose any machine type' },
    ],
  });

  const form = () => {
    const account = accountOf();
    const cat = catalogOf();
    const region = regionOf();
    return html`<div class="inf-split"><form class="inf-split__main" id="inf-launch-form" data-form="launch" novalidate>
      ${formSection({ n: 1, id: 'cloud', title: 'Cloud and region', body: html`
        ${optionCards({ name: 'account', legend: 'Cloud', value: account.id, items: accounts.map((a) => ({ value: a.id, badge: cloudBadge(a.cloud), title: a.cloud === 'gcp' ? 'Google Cloud' : 'Amazon Web Services', text: a.cloud === 'gcp' ? `Project ${a.projectId}` : `Account ${a.label}` })) })}
        <div class="inf-form__row">
          ${field({ name: 'region', label: 'Region', control: html`<select class="inf-input" name="region"${describedBy('region')}>${options(cat.regions.map((r) => [r.id, `${r.id} · ${r.label}`]), region.id)}</select>` })}
          ${field({ name: 'zone', label: 'Zone', control: html`<select class="inf-input" name="zone"${describedBy('zone')}>${options(region.zones.map((z) => [z, z]), region.zones[0])}</select>` })}
        </div>` })}
      ${formSection({ n: 2, id: 'machine', title: 'Machine', body: html`
        ${field({ name: 'name', label: 'Name', control: html`<input class="inf-input inf-mono" name="name" autocomplete="off" spellcheck="false" required${describedBy('name')}>`, help: 'Lower-case letters, numbers and dashes.', wrap: 'inf-field--narrow' })}
        <div data-region="sizes">${sizeCards(cat, region.id, 'medium')}</div>
        ${field({ name: 'machineType', label: 'Machine type', hidden: true, control: html`<select class="inf-input" name="machineType" disabled${describedBy('machineType')}>${options(Object.entries(cat.machineTypes).map(([id, m]) => [id, `${id} · ${m.vcpu} vCPU · ${m.memoryGb} GB`]), cat.sizes.medium)}</select>`, wrap: 'inf-field--narrow' })}` })}
      ${formSection({ n: 3, id: 'image', title: 'Image and disk', body: html`
        <div class="inf-form__row">
          ${field({ name: 'image', label: 'Linux image', control: html`<select class="inf-input" name="image"${describedBy('image')}>${options(cat.images.map((i) => [i.id, i.label]), cat.images[0].id)}</select>` })}
          ${field({ name: 'diskGb', label: 'Boot disk (GB, SSD)', control: html`<input class="inf-input" type="number" name="diskGb" value="30" min="${cat.disk.minGb}" max="2000" step="1" inputmode="numeric"${describedBy('diskGb')}>` })}
        </div>
        ${switchRow({ name: 'docker', title: 'Install Docker on first boot', text: 'Needed to deploy apps from Git. Adds about 40 seconds to the launch.', checked: true })}` })}
      ${formSection({ n: 4, id: 'access', title: 'Access', body: html`
        ${field({ name: 'sshKeyId', label: 'SSH key', control: html`<select class="inf-input" name="sshKeyId"${describedBy('sshKeyId')}>${options([...keys.map((k) => [k.id, `${k.name} · ${k.type}`]), [NEW_KEY, 'Paste a new public key…']], keys[0]?.id ?? NEW_KEY)}</select>` })}
        <div class="inf-form__row" data-new-key${keys.length ? html` hidden` : ''}>
          ${field({ name: 'keyName', label: 'Key name', control: html`<input class="inf-input" name="keyName" autocomplete="off"${keys.length ? html` disabled` : ''}${describedBy('keyName')}>`, help: 'e.g. the laptop it is on.' })}
          ${field({ name: 'publicKey', label: 'Public key', control: html`<textarea class="inf-input inf-mono" name="publicKey" rows="3" spellcheck="false"${keys.length ? html` disabled` : ''}${describedBy('publicKey')}></textarea>`, help: 'The .pub file: ssh-ed25519 AAAA… you@laptop' })}
        </div>
        ${field({ name: 'sshFrom', label: 'Allow SSH from', control: html`<select class="inf-input" name="sshFrom"${describedBy('sshFrom')}>${options([
          ...(myIp.ip ? [['my-ip', `My IP only · ${myIp.ip}`]] : []),
          ['anywhere', ctx.can('approve') ? 'Anywhere (not recommended)' : 'Anywhere (needs an Approver)'],
          ['custom', 'Custom range…'],
        ], myIp.ip ? 'my-ip' : 'custom')}</select>`, help: 'Ports 80 and 443 open when you add a public endpoint.' })}
        ${field({ name: 'sshCidr', label: 'Address range', hidden: Boolean(myIp.ip), control: html`<input class="inf-input inf-mono" name="sshCidr" placeholder="196.25.1.0/24" autocomplete="off"${myIp.ip ? html` disabled` : ''}${describedBy('sshCidr')}>`, wrap: 'inf-field--narrow' })}` })}
      ${formSection({ n: 5, id: 'endpoint', title: 'Public HTTPS endpoint', body: html`<p class="inf-muted">Public endpoints arrive in roadmap phase 3. You will add one from the VM’s page: the cloud’s own address, or your domain with a certificate that renews itself.</p>` })}
      <span class="inf-error" data-error="account" aria-live="polite"></span>
    </form>
    <div class="inf-split__side">${summary({
      rows: [['Cloud', html`<span data-sum="cloud"></span>`], ['Name', html`<span class="inf-mono" data-sum="name">—</span>`], ['Size', html`<span data-sum="size"></span>`], ['Image', html`<span data-sum="image"></span>`], ['Docker', html`<span data-sum="docker"></span>`], ['Endpoint', 'None yet']],
      total: '—',
      parts: ' ',
      action: html`<button class="btn btn--primary inf-summary__action" type="submit" form="inf-launch-form">Launch VM</button>`,
      footnote: 'Ready in about 2 minutes',
    })}</div></div>`;
  };

  const draw = () => {
    body.innerHTML = String(html`${messageRegion()}${form()}`);
    update();
  };

  /** Shows and hides what depends on a choice, and prices the VM as it stands. */
  function update() {
    const f = body.querySelector('form[data-form="launch"]');
    const v = formValues(f);
    const cat = catalogOf();
    const toggle = (selector, on) => {
      for (const block of body.querySelectorAll(selector)) {
        block.hidden = !on;
        for (const c of block.querySelectorAll('input, select, textarea')) c.disabled = !on;
      }
    };
    toggle('[data-field="machineType"]', v.size === 'custom');
    toggle('[data-new-key]', (v.sshKeyId ?? NEW_KEY) === NEW_KEY);
    toggle('[data-field="sshCidr"]', v.sshFrom === 'custom');
    const values = formValues(f);
    const machineType = values.size === 'custom' ? values.machineType : cat.sizes[values.size];
    const m = cat.machineTypes[machineType];
    const image = cat.images.find((i) => i.id === values.image);
    const e = estimate('vm', { region: values.region, machineType, diskGb: Number(values.diskGb) || 0 }, cat);
    const set = (key, text) => {
      const el = body.querySelector(`[data-sum="${key}"]`);
      if (el) el.textContent = text;
    };
    set('cloud', `${accountOf().cloudLabel} · ${values.zone}`);
    set('name', values.name || '—');
    set('size', m ? `${machineType} · ${m.vcpu} vCPU · ${m.memoryGb} GB` : '—');
    set('image', `${image?.label ?? '—'} · ${values.diskGb || '?'} GB`);
    set('docker', values.docker ? 'Installed' : 'Not installed');
    body.querySelector('[data-summary="total"]').textContent = usd(e.monthly);
    body.querySelector('[data-summary="parts"]').textContent = e.monthly === null ? e.problem
      : `${e.parts.map((p) => `${p.label} ${usd(p.monthly)}`).join(' · ')} · billed by ${accountOf().cloudLabel} to ${accountOf().label}`;
  }

  draw();

  body.addEventListener('change', (event) => {
    const { name, value } = event.target;
    if (name === 'account' && value !== state.account) {
      // Another cloud: its regions, sizes and images.
      state.account = value;
      state.region = accountOf().defaultRegion;
      const typed = body.querySelector('[name="name"]').value;
      draw();
      body.querySelector('[name="name"]').value = typed;
      update();
      return;
    }
    if (name === 'region') {
      state.region = value;
      const zone = body.querySelector('[name="zone"]');
      zone.innerHTML = String(html`${options(regionOf().zones.map((z) => [z, z]), regionOf().zones[0])}`);
      // Prices differ by region.
      const size = formValues(body.querySelector('form')).size;
      body.querySelector('[data-region="sizes"]').innerHTML = String(sizeCards(catalogOf(), value, size));
    }
    update();
  }, { signal: ctx.signal });
  body.addEventListener('input', (event) => {
    if (event.target.name === 'name') {
      const problem = event.target.value ? resourceNameProblem(event.target.value) : null;
      body.querySelector('[data-error="name"]').textContent = problem ?? '';
    }
    update();
  }, { signal: ctx.signal });

  body.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = body.querySelector('form[data-form="launch"]');
    const values = formValues(f);
    if (values.sshKeyId === NEW_KEY) delete values.sshKeyId;
    values.diskGb = Number(values.diskGb);
    const problem = resourceNameProblem(values.name);
    if (problem) return showFieldErrors(body, { name: problem });
    const submit = body.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { vm } = await ctx.api.post('vms', values);
      if (ctx.navigate) ctx.navigate(`/vms/${vm.name}`);
      else say(body, `Launching ${vm.name}.`, 'success');
    } catch (err) {
      if (isAbort(err)) return undefined;
      if (err.details?.fields) showFieldErrors(body, err.details.fields);
      else say(body, err.message, 'error');
    } finally {
      submit.disabled = false;
    }
    return undefined;
  }, { signal: ctx.signal });
}
