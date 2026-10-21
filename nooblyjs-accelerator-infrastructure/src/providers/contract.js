// The provider contract (architecture.md §6.1): what every cloud adapter (mock, gcp, aws) implements. Services call
// these and never a cloud SDK. Calls that start long cloud work return { ref, operation }, where `operation` is a
// handle the operations engine stores before waiting on it with waitFor(), so a restart waits again instead of
// starting the work twice. Every resource is created with the caller's labels, and list calls filter by them.
//
// The contract grows with the roadmap: metrics.vm joined in phase 2; databases, storage and iam join when their phases
// need them.
export const CONTRACT = {
  account: ['verify', 'regions', 'zones', 'detectNetwork', 'ensureNetwork'],
  catalog: ['machineTypes', 'images'],
  compute: ['create', 'get', 'list', 'start', 'stop', 'restart', 'remove', 'reserveAddress', 'releaseAddress', 'setFirewall', 'defaultAddress'],
  metrics: ['vm'],
  '': ['inventory', 'waitFor'],
};

/** The contract's methods a provider lacks, as 'area.method'. */
export function missingMethods(provider) {
  const missing = [];
  for (const [area, methods] of Object.entries(CONTRACT)) {
    const target = area ? provider?.[area] : provider;
    for (const m of methods) if (typeof target?.[m] !== 'function') missing.push(area ? `${area}.${m}` : m);
  }
  return missing;
}

/** Throws unless the provider implements the whole contract. */
export function checkProvider(provider) {
  const missing = missingMethods(provider);
  if (missing.length) throw new Error(`The ${provider?.name ?? 'unnamed'} provider lacks ${missing.join(', ')}.`);
  return provider;
}

/** True when a resource carries every label asked for. */
export const hasLabels = (resource, labels = {}) => Object.entries(labels).every(([k, v]) => resource.labels?.[k] === v);
