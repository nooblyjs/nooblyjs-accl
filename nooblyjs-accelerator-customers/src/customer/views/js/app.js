'use strict';

/**
 * Hash router for the customer admin UI.
 *
 *   #/customers[?q=&status=&stage=&sort=&page=]
 *   #/customers/{id}[?tab=contact|consent|notes|timeline|audit]
 *   #/organizations[?q=&page=]
 *   #/organizations/{id}[?tab=contact|notes]
 */
(function (CX) {
  const main = document.getElementById('cx-main');
  const ROUTES = [
    { re: /^\/customers\/([^/?]+)$/, nav: 'customers', view: (p, m) => CX.views.customer(main, p, decodeURIComponent(m[1])) },
    { re: /^\/customers$/, nav: 'customers', view: (p) => CX.views.customers(main, p) },
    { re: /^\/organizations\/([^/?]+)$/, nav: 'organizations', view: (p, m) => CX.views.organization(main, p, decodeURIComponent(m[1])) },
    { re: /^\/organizations$/, nav: 'organizations', view: (p) => CX.views.organizations(main, p) }
  ];

  async function route() {
    CX.ui.closeModals();
    const hash = window.location.hash.replace(/^#/, '') || '/customers';
    const [path, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const match = ROUTES.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
    if (!match) {
      window.location.hash = '#/customers';
      return;
    }
    document.querySelectorAll('[data-cx-nav]').forEach((a) => {
      const active = a.dataset.cxNav === match.r.nav;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    try {
      await match.r.view(params, match.m);
    } catch (err) {
      CX.ui.mount(main, CX.ui.h`<div class="alert alert-danger">${CX.ui.errorMessage(err)}</div>`);
    }
  }

  document.getElementById('cx-api-link').href = `${CX.api.base}/openapi.json`;
  // Show the Marketing link only when the host mounted the marketing module.
  fetch(`${CX.api.uiBase.replace(/\/customer$/, '')}/marketing/api/v1/health`, { credentials: 'same-origin' })
    .then((res) => { if (res.ok) document.getElementById('cx-marketing-link').classList.remove('d-none'); })
    .catch(() => {});
  window.addEventListener('hashchange', route);
  route();
})(window.CX);
