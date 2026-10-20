// What a resource costs a month, from its spec and its cloud's catalogue (architecture.md §12). The same module runs in
// the browser (a create form's live summary) and on the server (the lists, the Overview, the stored estimate), so the
// two can't disagree. Pure: no imports, no I/O. Amounts are USD, rounded to cents.
//
//   estimate('vm', { region, machineType, diskGb, status }, catalog)
//   estimate('database', { engine, region, tier, storageGb, ha, keepDays }, catalog)
//   estimate('bucket', { region, storageClass, bytes }, catalog)
//   → { monthly, hourly, parts: [{ label, monthly }] }, or { monthly: null, problem } when the catalogue lacks something

export const HOURS_PER_MONTH = 730;
const GB = 1e9;
/** VM states that bill for the machine; any other state bills only its disks. */
const MACHINE_BILLED = new Set(['starting', 'running', 'stopping', 'restarting']);

const cents = (n) => Math.round(n * 100) / 100;
const factorFor = (catalog, region) => catalog.regions?.find((r) => r.id === region)?.priceFactor ?? 1;
const unknown = (problem) => ({ monthly: null, hourly: null, parts: [], problem });

function total(parts) {
  const rounded = parts.map((p) => ({ label: p.label, monthly: cents(p.monthly) }));
  const monthly = cents(parts.reduce((sum, p) => sum + p.monthly, 0));
  return { monthly, hourly: monthly / HOURS_PER_MONTH, parts: rounded };
}

function vm({ region, machineType, diskGb = 0, status = 'running' }, catalog) {
  const machine = catalog.machineTypes?.[machineType];
  if (!machine) return unknown(`${catalog.short ?? catalog.cloud} has no machine type ${machineType} in the catalogue.`);
  const f = factorFor(catalog, region);
  const parts = [];
  if (MACHINE_BILLED.has(status)) parts.push({ label: 'VM', monthly: machine.hourly * HOURS_PER_MONTH * f });
  parts.push({ label: 'disk', monthly: diskGb * catalog.disk.ssdGbMonth * f });
  return total(parts);
}

function database({ engine, region, tier, storageGb = 0, ha = false, keepDays = 7 }, catalog) {
  const offer = catalog.databases?.[engine];
  if (!offer) return unknown(`No ${engine} databases on ${catalog.short ?? catalog.cloud}.`);
  const f = factorFor(catalog, region);
  if (engine === 'mongodb') {
    // A VM of the tier's machine type, its boot and data disks, and one daily dump kept per day of retention.
    const machine = catalog.machineTypes?.[offer.tiers?.[tier]];
    if (!machine) return unknown(`No ${tier} size for MongoDB on ${catalog.short ?? catalog.cloud}.`);
    return total([
      { label: 'VM', monthly: machine.hourly * HOURS_PER_MONTH * f },
      { label: 'disks', monthly: (offer.bootDiskGb + storageGb) * catalog.disk.ssdGbMonth * f },
      { label: 'backups', monthly: storageGb * offer.dumpRatio * keepDays * catalog.buckets.classes.standard.gbMonth * f },
    ]);
  }
  const server = offer.tiers?.[tier];
  if (!server) return unknown(`No ${tier} size for ${engine} on ${catalog.short ?? catalog.cloud}.`);
  return total([
    { label: 'server', monthly: server.hourly * HOURS_PER_MONTH * f * (ha ? offer.haFactor : 1) },
    { label: 'storage', monthly: storageGb * offer.storageGbMonth * f },
    { label: 'backups', monthly: storageGb * offer.backupGbMonth * f },
  ]);
}

function bucket({ region, storageClass = 'standard', bytes = 0 }, catalog) {
  const cls = catalog.buckets?.classes?.[storageClass];
  if (!cls) return unknown(`No ${storageClass} storage class on ${catalog.short ?? catalog.cloud}.`);
  const perGb = cls.gbMonth * factorFor(catalog, region);
  return { ...total([{ label: 'storage', monthly: (bytes / GB) * perGb }]), perGb };
}

const KINDS = { vm, database, bucket };

export function estimate(kind, spec, catalog) {
  const fn = KINDS[kind];
  if (!fn) throw new Error(`estimate: no kind ${kind}`);
  if (!catalog) return unknown('No catalogue for this cloud.');
  return fn(spec ?? {}, catalog);
}

/** "$30", "$3.10", "~$0.03 / GB": how the screens say an amount (whole dollars from $10, cents below). */
export function usd(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const value = Number(amount);
  return Math.abs(value) >= 10
    ? `$${Math.round(value).toLocaleString('en-US')}`
    : `$${value.toFixed(2)}`;
}
