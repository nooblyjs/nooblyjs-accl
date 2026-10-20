// What a provider throws when a cloud says no (architecture.md §7, "Failure"). The adapter maps the cloud's own error
// to a code and a message in plain words, which is safe to show a person; anything else a provider throws is a fault
// and is logged, not shown.
export const CLOUD_ERRORS = {
  invalid: 'The cloud refused the request.',
  permission: 'The account is missing a permission.',
  not_found: 'The cloud has no such resource.',
  conflict: 'That name is taken in the cloud.',
  quota: 'The account has reached a quota.',
  unavailable: 'The cloud is not answering.',
};

export class CloudError extends Error {
  constructor(code, message) {
    super(message ?? CLOUD_ERRORS[code] ?? CLOUD_ERRORS.unavailable);
    this.name = 'CloudError';
    this.code = CLOUD_ERRORS[code] ? code : 'unavailable';
  }
}

export const isCloudError = (err) => err instanceof CloudError;
