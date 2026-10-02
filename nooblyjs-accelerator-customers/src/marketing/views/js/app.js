'use strict';

/**
 * Hash router for the marketing admin UI.
 *
 *   #/campaigns, #/campaigns/{id}
 *   #/messages/{id}
 *   #/templates, #/templates/{id}   (#/templates/new for a new one)
 *   #/communications[?status=&channel=&customerId=&messageId=&page=]
 *   #/suppressions
 */
(function (CX) {
  const main = document.getElementById('cx-main');
  const ROUTES = [
    { re: /^\/campaigns\/([^/?]+)$/, nav: 'campaigns', view: (p, m) => CX.views.campaign(main, p, decodeURIComponent(m[1])) },
    { re: /^\/campaigns$/, nav: 'campaigns', view: (p) => CX.views.campaigns(main, p) },
    { re: /^\/messages\/([^/?]+)$/, nav: 'campaigns', view: (p, m) => CX.views.message(main, p, decodeURIComponent(m[1])) },
    { re: /^\/templates\/([^/?]+)$/, nav: 'templates', view: (p, m) => CX.views.template(main, p, decodeURIComponent(m[1])) },
    { re: /^\/templates$/, nav: 'templates', view: (p) => CX.views.templates(main, p) },
    { re: /^\/communications$/, nav: 'communications', view: (p) => CX.views.communications(main, p) },
    { re: /^\/suppressions$/, nav: 'suppressions', view: (p) => CX.views.suppressions(main, p) }
  ];

  async function route() {
    CX.ui.closeModals();
    const hash = window.location.hash.replace(/^#/, '') || '/campaigns';
    const [path, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const match = ROUTES.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
    if (!match) {
      window.location.hash = '#/campaigns';
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

  /** Marketing reference data (cached). */
  let ref = null;
  CX.marketingRef = () => {
    if (!ref) ref = CX.api.get('/reference').catch((err) => { ref = null; throw err; });
    return ref;
  };

  document.getElementById('cx-api-link').href = `${CX.api.base}/openapi.json`;
  window.addEventListener('hashchange', route);
  route();
})(window.CX);
