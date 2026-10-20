// What each Noobly Cloud event says (architecture.md §7). Every event this accelerator emits goes through withWords(),
// which adds `system: 'infrastructure'` and the sentence the launcher's Activity shows ("Stevie" + "connected GCP
// account stevie-prod"), and records the ones worth keeping in this accelerator's activity log, with the verb pill
// and the short text the Overview shows ("Deployed" · "storefront a1f3c9e to web-01"). `quiet` events (an operation's
// progress) are emitted but not kept.

export const CLOUD = { gcp: 'GCP', aws: 'AWS' };
const KIND = { vm: 'VM', app: 'app', database: 'database', bucket: 'bucket', account: 'account' };
const cloudOf = (p) => CLOUD[p.cloud] ?? p.cloud ?? 'the cloud';
const resourceOf = (p) => `${KIND[p.resource?.type] ?? p.resource?.type ?? 'resource'} ${p.resource?.name ?? ''}`.trim();

/** type → { verb, tone, text(p), summary?(p) } or { quiet: true }. Tones are the kit's pill tones. */
const WORDS = {
  'infrastructure.operation.queued': { quiet: true },
  'infrastructure.operation.started': { quiet: true },
  'infrastructure.operation.progress': { quiet: true },
  'infrastructure.operation.succeeded': { quiet: true },
  'infrastructure.operation.failed': {
    verb: 'Failed', tone: 'danger',
    text: (p) => `${p.label}${p.stepLabel ? ` at “${p.stepLabel}”` : ''}`,
    summary: (p) => `could not finish “${p.label}”: ${p.reason}`,
  },
  'infrastructure.operation.cancelled': { verb: 'Cancelled', tone: 'neutral', text: (p) => p.label, summary: (p) => `cancelled “${p.label}”` },

  'infrastructure.account.connected': { verb: 'Connected', tone: 'success', text: (p) => `${cloudOf(p)} account ${p.name}` },
  'infrastructure.account.needs_attention': {
    verb: 'Attention', tone: 'danger',
    text: (p) => `${cloudOf(p)} account ${p.name}: ${p.reason}`,
    summary: (p) => `found that ${cloudOf(p)} account ${p.name} needs attention: ${p.reason}`,
  },
  'infrastructure.account.changed': { verb: 'Changed', tone: 'neutral', text: (p) => `${cloudOf(p)} account ${p.name}` },
  'infrastructure.account.removed': { verb: 'Removed', tone: 'neutral', text: (p) => `${cloudOf(p)} account ${p.name}` },

  'infrastructure.resource.missing': {
    verb: 'Missing', tone: 'danger',
    text: (p) => `${resourceOf(p)} is no longer in ${cloudOf(p)}`,
    summary: (p) => `found that ${resourceOf(p)} is no longer in ${cloudOf(p)}`,
  },
  'infrastructure.resource.changed': {
    verb: 'Changed', tone: 'warning',
    text: (p) => `${resourceOf(p)} is ${p.status} in ${cloudOf(p)}, changed outside Noobly Cloud`,
    summary: (p) => `found that ${resourceOf(p)} was changed outside Noobly Cloud: it is ${p.status}`,
  },

  // The resources' own events. Their operations arrive in roadmap phases 2–6; the seed story already uses them.
  'infrastructure.vm.created': { verb: 'Created', tone: 'info', text: (p) => `VM ${p.name} · ${cloudOf(p)} ${p.region}` },
  'infrastructure.vm.started': { verb: 'Started', tone: 'success', text: (p) => `VM ${p.name}` },
  'infrastructure.vm.stopped': { verb: 'Stopped', tone: 'neutral', text: (p) => `VM ${p.name}` },
  'infrastructure.vm.deleted': { verb: 'Deleted', tone: 'neutral', text: (p) => `VM ${p.name}` },
  'infrastructure.app.building': {
    verb: 'Building', tone: 'warning',
    text: (p) => `${p.app} ${p.commit} on ${p.vm}`,
    summary: (p) => `started building ${p.app} ${p.commit} on ${p.vm}`,
  },
  'infrastructure.app.deployed': { verb: 'Deployed', tone: 'success', text: (p) => `${p.app} ${p.commit} to ${p.vm}` },
  'infrastructure.database.created': { verb: 'Created', tone: 'info', text: (p) => `database ${p.name} · ${cloudOf(p)} ${p.region}` },
  'infrastructure.database.backed_up': {
    verb: 'Backup', tone: 'success',
    text: (p) => `${p.name} · ${p.size} snapshot`,
    summary: (p) => `backed up ${p.name} (${p.size})`,
  },
  'infrastructure.bucket.created': { verb: 'Created', tone: 'info', text: (p) => `bucket ${p.name} · ${cloudOf(p)} ${p.region}` },
};

/** The words for an event: { verb, tone, text, summary }, { quiet: true }, or null when it has none. */
export function words(type, payload = {}) {
  const w = WORDS[type];
  if (!w) return null;
  if (w.quiet) return { quiet: true };
  const text = w.text(payload);
  return { verb: w.verb, tone: w.tone, text, summary: w.summary ? w.summary(payload) : `${w.verb.toLowerCase()} ${text}` };
}

/**
 * The launcher's `events`, with every emit from this accelerator named and worded, and kept in the activity log when
 * `record` is given. A failure to record never fails the emit.
 */
export function withWords(events, { record, log } = {}) {
  return {
    ...events,
    async emit(type, payload = {}, options) {
      const w = words(type, payload);
      const said = payload.summary || !w || w.quiet ? {} : { summary: w.summary };
      const full = { system: 'infrastructure', ...payload, ...said };
      const event = await events.emit(type, full, options);
      if (record && w && !w.quiet) {
        await record({ type, payload: full, words: w, actor: options?.actor ?? null }).catch((err) => log?.warn(`activity: ${err.message}`));
      }
      return event;
    },
  };
}
