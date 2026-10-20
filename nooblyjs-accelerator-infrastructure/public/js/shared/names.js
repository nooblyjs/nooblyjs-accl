// Name rules, shared by the browser (forms check as you type) and the server (which decides). No imports, so both can
// load it (architecture.md §11.5).

/** VMs, apps, databases and cloud accounts: lower-case letters, numbers and dashes, starting with a letter (RFC 1035). */
const RESOURCE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
/** Buckets: 3–63 lower-case letters, numbers, dots and dashes, starting and ending with a letter or number. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const isResourceName = (name) => typeof name === 'string' && RESOURCE_NAME.test(name);

export const isBucketName = (name) => typeof name === 'string' && BUCKET_NAME.test(name)
  && !name.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(name) && !name.startsWith('goog') && !name.startsWith('xn--');

/** Why a resource name is refused, in words for a form, or null when it is fine. */
export function resourceNameProblem(name) {
  if (!name) return 'Give it a name.';
  if (name.length > 63) return 'At most 63 characters.';
  if (!/^[a-z]/.test(name)) return 'Start with a lower-case letter.';
  if (/-$/.test(name)) return 'End with a letter or a number.';
  if (!isResourceName(name)) return 'Lower-case letters, numbers and dashes only.';
  return null;
}
