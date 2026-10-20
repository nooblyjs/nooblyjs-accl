// Which database engine (the mockups' .eng badge): "MySQL 8.4", "MongoDB 7.0".
import { html } from '/ui/js/html.js';

const ENGINES = { mysql: 'MySQL', mongodb: 'MongoDB' };

export const engineBadge = (engine, version) => html`<span class="inf-engine inf-engine--${ENGINES[engine] ? engine : 'other'}">${ENGINES[engine] ?? engine}${version ? ` ${version}` : ''}</span>`;
