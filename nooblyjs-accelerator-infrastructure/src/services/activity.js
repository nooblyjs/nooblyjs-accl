// The activity log (product.md §6.1, §6.11): everything that was created, changed, deployed, backed up or deleted, and
// who did it. One append-only YAML stream, activity/ledger.yaml, written by withWords() for every worded event.
export const ACTIVITY_KINDS = ['account', 'vm', 'app', 'database', 'bucket'];

export function createActivity({ repos, host, now }) {
  return {
    /** Called by withWords() for each worded event. */
    async record({ type, payload, words, actor }) {
      await repos.activity.append({
        at: new Date(now()).toISOString(),
        type,
        verb: words.verb,
        tone: words.tone,
        text: words.text,
        summary: words.summary,
        actor: actor ?? null,
        resource: payload.resource ?? null,
        account: payload.account ?? null,
      });
    },
    /** Newest first. `kind` keeps one kind of resource ('vm'); `person` one person's doings. */
    async list({ limit = 50, kind, person } = {}) {
      const items = (await repos.activity.list())
        .filter((a) => !kind || a.resource?.type === kind)
        .filter((a) => !person || a.actor === person)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
      const names = new Map();
      for (const id of new Set(items.map((a) => a.actor).filter(Boolean))) {
        const person_ = await host.people.get(id).catch(() => null);
        names.set(id, person_?.name ?? id);
      }
      return items.map((a) => ({
        at: a.at,
        type: a.type,
        verb: a.verb,
        tone: a.tone,
        text: a.text,
        summary: a.summary,
        actor: a.actor ? { id: a.actor, name: names.get(a.actor) } : null,
        resource: a.resource ?? null,
        account: a.account ?? null,
      }));
    },
  };
}
