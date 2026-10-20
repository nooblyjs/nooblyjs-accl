// Cloud accounts (product.md §6.11, architecture.md §5): the GCP projects and AWS accounts Noobly Cloud works in.
// Connecting one stores its credentials as a secret and runs account.connect; the account check job (§8) re-checks
// each account every 15 minutes. Only an Owner (change-guardrails) connects, changes or removes accounts, and never an
// agent. The API never returns credentials.
import { HttpError, notFound, unprocessable } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { needs, peopleOnly } from '../util/http.js';
import { resourceNameProblem } from '../../public/js/shared/names.js';
import { CloudError } from '../providers/errors.js';
import { PROVIDER_LABEL } from '../providers/index.js';
import { CLOUD } from './event-words.js';
import { accountConnect } from './steps/account-connect.js';
import { who, inProgress } from './operations.js';

const CLOUDS = ['gcp', 'aws'];
const GCP_PROJECT = /^[a-z][-a-z0-9]{4,28}[a-z0-9]$/;
const AWS_ACCOUNT = /^\d{12}$/;
const MAX_CREDENTIALS = 20_000;
const STATE = {
  connecting: { text: 'Connecting', tone: 'info' },
  connected: { text: 'Connected', tone: 'success' },
  'needs-attention': { text: 'Needs attention', tone: 'danger' },
};

export function createAccounts({ repos, host, operations, providers, secrets, catalog, config, now, log }) {
  const iso = () => new Date(now()).toISOString();
  const emit = (type, account, extra = {}, actor = null) => host.events.emit(type, {
    resource: { type: 'account', name: account.id }, account: account.id, cloud: account.cloud, name: account.name, ...extra,
  }, { actor });

  const connect = accountConnect({ labels: config.labels });
  operations.define('account.connect', {
    ...connect,
    async succeeded(ctx) {
      const account = await repos.accounts.update(ctx.op.account, (a) => a && {
        ...a,
        state: 'connected',
        stateMessage: null,
        identity: ctx.state.identity ?? a.identity ?? null,
        network: { ...(a.network ?? {}), [a.defaultRegion]: ctx.state.networkRef },
        checkedAt: iso(),
        connectedAt: a.connectedAt ?? iso(),
      });
      if (account) await emit('infrastructure.account.connected', account, {}, ctx.op.requestedBy?.id);
    },
    async failed(ctx, err) {
      await attention(ctx.op.account, err?.message ?? 'Connecting failed.', ctx.op.requestedBy?.id);
    },
    async cancelled(ctx) {
      await attention(ctx.op.account, 'Connecting was cancelled.', ctx.op.cancelledBy?.id);
    },
  });

  /** Marks an account as needing attention, and says so once (not on every check that finds the same). */
  async function attention(id, reason, actor = null) {
    let changed = false;
    const account = await repos.accounts.update(id, (a) => {
      if (!a) return null;
      changed = a.state !== 'needs-attention' || a.stateMessage !== reason;
      return { ...a, state: 'needs-attention', stateMessage: reason, checkedAt: iso() };
    });
    if (account && changed) await emit('infrastructure.account.needs_attention', account, { reason }, actor);
    return account;
  }

  async function counts() {
    const [vms, databases, buckets] = await Promise.all([repos.vms.list(), repos.databases.list(), repos.buckets.list()]);
    const of = (list, id) => list.filter((r) => r.account === id).length;
    return (id) => {
      const c = { vms: of(vms.filter((v) => v.role !== 'database'), id), databases: of(databases, id), buckets: of(buckets, id) };
      return { ...c, total: c.vms + c.databases + c.buckets };
    };
  }

  function view(account, resources = null, operation = null) {
    const state = STATE[account.state] ?? { text: account.state, tone: 'neutral' };
    const region = catalog.region(account.cloud, account.defaultRegion);
    return {
      id: account.id,
      cloud: account.cloud,
      cloudLabel: CLOUD[account.cloud] ?? account.cloud,
      name: account.name,
      label: account.cloud === 'aws' && account.accountId ? `${account.name} · ${account.accountId.slice(-4)}` : account.name,
      provider: account.provider,
      providerLabel: PROVIDER_LABEL[account.provider] ?? account.provider,
      projectId: account.projectId ?? null,
      accountId: account.accountId ?? null,
      defaultRegion: account.defaultRegion,
      regionLabel: region ? `${region.id} · ${region.label}` : account.defaultRegion,
      state: account.state,
      stateText: operation?.status === 'running' ? operation.statusText : state.text,
      stateTone: state.tone,
      stateMessage: account.stateMessage ?? null,
      identity: account.identity ?? null,
      checkedAt: account.checkedAt ?? null,
      createdAt: account.createdAt,
      createdBy: account.createdBy ?? null,
      resources,
      operation,
    };
  }

  /** The account's operation still going, if any. */
  async function activeOperation(id) {
    return (await operations.list({ account: id, status: 'active' }))[0] ?? null;
  }

  async function mustGet(id) {
    const account = await repos.accounts.get(id);
    if (!account) throw notFound(`No cloud account ${id}.`);
    return account;
  }

  /** Checks what a person sent to connect an account. Throws 422 with a message per field. */
  async function validate(body) {
    const fields = {};
    const cloud = body.cloud;
    if (!CLOUDS.includes(cloud)) fields.cloud = 'Pick Google Cloud or AWS.';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const nameProblem = resourceNameProblem(name);
    if (nameProblem) fields.name = nameProblem;
    else if (await repos.accounts.get(name)) fields.name = `There is already an account called ${name}.`;
    if (cloud === 'gcp' && !GCP_PROJECT.test(body.projectId ?? '')) fields.projectId = 'A GCP project ID: 6–30 lower-case letters, numbers and dashes, starting with a letter.';
    if (cloud === 'aws' && !AWS_ACCOUNT.test(body.accountId ?? '')) fields.accountId = 'An AWS account ID: 12 digits.';
    if (CLOUDS.includes(cloud) && !catalog.region(cloud, body.defaultRegion)) fields.defaultRegion = 'Pick a region.';
    const credentials = body.credentials;
    const text = typeof credentials === 'string' ? credentials.trim() : credentials && typeof credentials === 'object' ? JSON.stringify(credentials) : '';
    if (!text) fields.credentials = cloud === 'aws' ? 'Paste the role ARN and external ID, or access keys.' : 'Paste the service account key (JSON).';
    else if (text.length > MAX_CREDENTIALS) fields.credentials = 'That is too long to be credentials.';
    const provider = body.provider ?? (CLOUDS.includes(cloud) ? providers.defaultFor(cloud) : null);
    if (CLOUDS.includes(cloud) && (!provider || !providers.enabled.includes(provider))) {
      fields.provider = `This install can't connect ${CLOUD[cloud]} accounts (INFRA_PROVIDERS is ${providers.enabled.join(', ')}).`;
    }
    if (Object.keys(fields).length) throw unprocessable('Check the highlighted fields.', { fields });
    return { cloud, name, provider, credentials: typeof credentials === 'string' ? credentials.trim() : credentials };
  }

  async function get(id) {
    const account = await mustGet(id);
    return view(account, (await counts())(id), await activeOperation(id));
  }

  /** Checks an account's credentials now (the account check job does this every 15 minutes). */
  async function check(id) {
    const account = await mustGet(id);
    if (await activeOperation(id)) return get(id);
    let result;
    try {
      result = await (await providers.forAccount(account)).account.verify();
    } catch (err) {
      if (!(err instanceof CloudError)) log.warn(`account check ${id}: ${err.stack ?? err.message}`);
      result = { ok: false, message: err instanceof CloudError ? err.message : 'The cloud could not be reached.' };
    }
    if (!result.ok) await attention(id, result.message);
    else {
      const was = account.state;
      const next = await repos.accounts.update(id, (a) => a && { ...a, state: 'connected', stateMessage: null, identity: result.identity ?? a.identity, checkedAt: iso() });
      if (was !== 'connected') await emit('infrastructure.account.connected', next);
    }
    return get(id);
  }

  return {
    view,
    attention,
    get,
    check,

    async list() {
      const [accounts, count, active] = await Promise.all([repos.accounts.list(), counts(), operations.list({ status: 'active' })]);
      return accounts
        .sort((a, b) => CLOUDS.indexOf(a.cloud) - CLOUDS.indexOf(b.cloud) || a.name.localeCompare(b.name))
        .map((a) => view(a, count(a.id), active.find((op) => op.account === a.id && op.resource?.type === 'account') ?? null));
    },

    /** Connects an account: stores the credentials, writes the record, and runs account.connect. 202-style result. */
    async connect(body, person) {
      await peopleOnly(host, person, 'connect a cloud account');
      await needs(host, person, 'change-guardrails', 'connect a cloud account');
      const { cloud, name, provider, credentials } = await validate(body ?? {});
      const credentialRef = await secrets.put('cloud-credentials', credentials);
      const account = {
        id: name,
        cloud,
        name,
        provider,
        ...(cloud === 'gcp' ? { projectId: body.projectId } : { accountId: body.accountId }),
        defaultRegion: body.defaultRegion,
        credentialRef,
        state: 'connecting',
        createdAt: iso(),
        createdBy: who(person),
      };
      await repos.accounts.write(account);
      const operation = await operations.start('account.connect', { resource: { type: 'account', name }, account: name, person });
      return { account: view(account, { vms: 0, databases: 0, buckets: 0, total: 0 }, operation), operation };
    },

    /** Changes the default region or the credentials (which re-checks the account). */
    async update(id, body, person) {
      await peopleOnly(host, person, 'change a cloud account');
      await needs(host, person, 'change-guardrails', 'change a cloud account');
      const account = await mustGet(id);
      const fields = {};
      if (body.defaultRegion !== undefined && !catalog.region(account.cloud, body.defaultRegion)) fields.defaultRegion = 'Pick a region.';
      if (body.credentials !== undefined && !(typeof body.credentials === 'string' ? body.credentials.trim() : body.credentials)) fields.credentials = 'Paste the new credentials, or leave them out.';
      if (Object.keys(fields).length) throw unprocessable('Check the highlighted fields.', { fields });
      const oldRef = account.credentialRef;
      const credentialRef = body.credentials !== undefined ? await secrets.put('cloud-credentials', typeof body.credentials === 'string' ? body.credentials.trim() : body.credentials) : oldRef;
      const next = await repos.accounts.update(id, (a) => ({
        ...a,
        ...(body.defaultRegion !== undefined ? { defaultRegion: body.defaultRegion } : {}),
        credentialRef,
      }));
      if (credentialRef !== oldRef) {
        providers.forget(id);
        await secrets.remove(oldRef);
      }
      await emit('infrastructure.account.changed', next, {}, person?.id);
      return check(id);
    },

    async checkAll() {
      for (const account of await repos.accounts.list()) {
        if (account.state === 'connecting') continue;
        await check(account.id).catch((err) => log.warn(`account check ${account.id}: ${err.message}`));
      }
    },

    /** Removes an account that holds nothing. The person types its name to confirm. */
    async remove(id, body, person) {
      await peopleOnly(host, person, 'remove a cloud account');
      await needs(host, person, 'change-guardrails', 'remove a cloud account');
      const account = await mustGet(id);
      if (body?.confirm !== id) throw unprocessable(`Type the account's name (${id}) to remove it.`, { fields: { confirm: `Type ${id}.` } });
      const count = (await counts())(id);
      if (count.total) {
        throw new HttpError(409, 'conflict', `${account.name} still has ${count.total} resource${count.total === 1 ? '' : 's'} in Noobly Cloud. Delete them first.`, { resources: count });
      }
      if ((await operations.list({ account: id })).some(inProgress)) throw new HttpError(409, 'conflict', `Wait for ${account.name}'s operation to finish, or cancel it.`);
      await repos.accounts.remove(id);
      providers.forget(id);
      await secrets.remove(account.credentialRef);
      await emit('infrastructure.account.removed', account, {}, person?.id);
      return { removed: id };
    },

    /** After the seed story: mock accounts get mock credentials, as if they had been connected. */
    async seedCredentials() {
      for (const account of await repos.accounts.list()) {
        if (account.provider !== 'mock' || (account.credentialRef && await secrets.get(account.credentialRef).catch(() => null))) continue;
        const credentialRef = await secrets.put('cloud-credentials', { type: 'mock', note: `Seeded credentials for ${account.id}`, token: newId('mock', 24) });
        await repos.accounts.update(account.id, (a) => a && { ...a, credentialRef });
      }
    },
  };
}
