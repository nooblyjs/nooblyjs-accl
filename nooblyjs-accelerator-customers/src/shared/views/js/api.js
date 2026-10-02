'use strict';

/**
 * Thin client for the customer module REST API. The API base is derived from
 * the page's own mount path, so a host-chosen basePath works unchanged.
 */
window.CX = window.CX || {};

(function (CX) {
  const uiBase = window.location.pathname.replace(/\/(index\.html)?$/, '');
  const base = `${uiBase}/api/v1`;

  class ApiError extends Error {
    constructor(status, body) {
      const error = (body && body.error) || {};
      super(error.message || `Request failed (${status})`);
      this.status = status;
      this.code = error.code || 'error';
      this.details = Array.isArray(error.details) ? error.details : [];
    }
  }

  /**
   * @param {string} method - HTTP method
   * @param {string} path - Path below the API base, e.g. `/customers`
   * @param {Object} [opts] - `{ body, query, version }` (version → If-Match)
   * @return {Promise<*>} Parsed JSON (null for 204)
   */
  async function request(method, path, { body, query, version } = {}) {
    const url = new URL(base + path, window.location.origin);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (version !== undefined && version !== null) headers['If-Match'] = `W/"${version}"`;
    const res = await fetch(url, {
      method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  let referenceCache = null;

  CX.api = {
    base,
    uiBase,
    ApiError,
    request,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    patch: (path, body, version) => request('PATCH', path, { body, version }),
    del: (path, version) => request('DELETE', path, { version }),
    /** Enumerations and countries for forms (cached). */
    reference() {
      if (!referenceCache) referenceCache = request('GET', '/reference').catch((err) => { referenceCache = null; throw err; });
      return referenceCache;
    }
  };
})(window.CX);
