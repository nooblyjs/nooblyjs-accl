// Noobly Cloud at a glance: the Overview's numbers and the sidebar's status card (product.md §5, §6.1), and what
// other accelerators may ask for. Everything is counted from the records; with nothing on disk it says zero. Cloud
// accounts, resources and spend arrive in roadmap phase 1, so for now every count is zero.

export function createSummary() {
  /** The Overview's totals. */
  async function summary() {
    return {
      accounts: { count: 0, connected: 0 },
      resources: { count: 0 },
      vms: { count: 0 },
      apps: { count: 0 },
      databases: { count: 0 },
      buckets: { count: 0, bytes: 0 },
      spend: { estimate: 0, currency: 'USD' },
    };
  }

  /** The shape the launcher's frame draws under the sidebar's nav (AppStatus: badges and card). */
  async function status() {
    const s = await summary();
    if (s.accounts.count === 0) {
      return { card: { pill: { text: 'No cloud accounts yet', tone: 'neutral' }, lines: ['Connect GCP or AWS to start.'] } };
    }
    return { card: { pill: { text: `${s.accounts.connected} of ${s.accounts.count} connected`, tone: s.accounts.connected === s.accounts.count ? 'success' : 'warning' } } };
  }

  return {
    summary,
    status,
    services: {
      /** The Overview's totals, for another accelerator's dashboard. */
      summary,
    },
  };
}
