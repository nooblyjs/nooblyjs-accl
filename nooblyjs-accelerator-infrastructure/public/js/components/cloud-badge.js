// Which cloud (the mockups' .prov badge): the short name is the signal, the colour repeats it.
import { html } from '/ui/js/html.js';

const CLOUDS = { gcp: { short: 'GCP', label: 'Google Cloud' }, aws: { short: 'AWS', label: 'Amazon Web Services' } };

export const cloudBadge = (cloud) => {
  const c = CLOUDS[cloud] ?? { short: String(cloud ?? '?').toUpperCase(), label: String(cloud ?? 'Unknown cloud') };
  return html`<span class="inf-cloud inf-cloud--${CLOUDS[cloud] ? cloud : 'other'}" title="${c.label}">${c.short}</span>`;
};

export const cloudLabel = (cloud) => CLOUDS[cloud]?.label ?? String(cloud ?? '');
