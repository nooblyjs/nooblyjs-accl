'use strict';

// Resolve the API from the UI's own mount path, so a host-chosen basePath works.
(function () {
  const uiBase = window.location.pathname.replace(/\/(index\.html)?$/, '');
  const apiBase = `${uiBase}/api/v1`;
  const badge = document.getElementById('health-badge');
  document.getElementById('api-base').textContent = apiBase;
  document.getElementById('openapi-link').href = `${apiBase}/openapi.json`;

  fetch(`${apiBase}/health`, { credentials: 'same-origin' })
    .then((res) => res.json())
    .then((body) => {
      badge.textContent = body.status;
      badge.className = `badge ${body.status === 'ok' ? 'text-bg-success' : 'text-bg-warning'}`;
    })
    .catch(() => {
      badge.textContent = 'unreachable';
      badge.className = 'badge text-bg-danger';
    });
})();
