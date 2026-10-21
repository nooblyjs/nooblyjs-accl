// The create forms' pieces (the mockups' .sec, .opt, .sw and summary aside; architecture.md §11.3): numbered sections,
// option cards (radio buttons), switches (checkboxes with role="switch"), labelled fields with their help and error,
// and the summary beside the form. Every control is a real form control with a label.
import { html } from '/ui/js/html.js';

/** A numbered section: formSection({ n: 1, id: 'cloud', title: 'Cloud and region', body }). */
export const formSection = ({ n, id, title, body, hidden = false }) => html`<section class="card inf-sec" aria-labelledby="inf-sec-${id}"${hidden ? html` hidden` : ''}><h2 class="inf-sec__title" id="inf-sec-${id}"><span class="inf-step" aria-hidden="true">${n}</span>${title}</h2>${body}</section>`;

/**
 * A labelled control with its help and its error (filled by showFieldErrors): field({ name, label, control, help }).
 * `control` is the control's HTML; give it id="inf-f-<name>" and aria-describedby="inf-f-<name>-help inf-f-<name>-error".
 */
export const field = ({ name, label, control, help, hidden = false, wrap = '' }) => html`<div class="inf-field${wrap ? ` ${wrap}` : ''}" data-field="${name}"${hidden ? html` hidden` : ''}><label class="inf-field__label" for="inf-f-${name}">${label}</label>${control}${help ? html`<span class="inf-help" id="inf-f-${name}-help">${help}</span>` : ''}<span class="inf-error" data-error="${name}" id="inf-f-${name}-error" aria-live="polite"></span></div>`;

/** The attributes a field's control needs: id and aria-describedby. */
export const describedBy = (name) => html` id="inf-f-${name}" aria-describedby="inf-f-${name}-help inf-f-${name}-error"`;

/**
 * Option cards, one radio each: optionCards({ name, legend, value, items: [{ value, title, text, price, badge }] }).
 * The checked card is outlined (CSS :has(:checked)).
 */
export const optionCards = ({ name, legend, value, items, wide = false }) => html`<fieldset class="inf-choice${wide ? ' inf-choice--wide' : ''}"><legend class="inf-field__label">${legend}</legend>${items.map((item) => html`<label class="inf-option inf-option--card"><input type="radio" name="${name}" value="${item.value}"${item.value === value ? html` checked` : ''}${item.disabled ? html` disabled` : ''}><span class="inf-option__body">${item.badge || item.title ? html`<span class="inf-option__head">${item.badge ?? ''}<span class="inf-option__title">${item.title}</span></span>` : ''}${item.text ? html`<span class="inf-option__text">${item.text}</span>` : ''}${item.price ? html`<span class="inf-option__price">${item.price}</span>` : ''}</span></label>`)}</fieldset><span class="inf-error" data-error="${name}" aria-live="polite"></span>`;

/** A switch: a checkbox with role="switch", its title and what it does. */
export const switchRow = ({ name, title, text, checked = false }) => html`<label class="inf-switch"><input type="checkbox" role="switch" class="inf-switch__input" name="${name}"${checked ? html` checked` : ''}><span><span class="inf-option__title">${title}</span>${text ? html`<span class="inf-option__text">${text}</span>` : ''}</span></label>`;

/** The summary beside a form: rows, the monthly estimate, how it adds up, the submit button and a last word. */
export const summary = ({ rows, totalLabel = 'Est. per month', total, parts, action, footnote }) => html`<aside class="card inf-summary" aria-labelledby="inf-summary-h"><h2 class="card__title" id="inf-summary-h">Summary</h2><dl class="inf-sumrows">${rows.map(([label, value]) => html`<div class="inf-sumrows__row"><dt>${label}</dt><dd>${value}</dd></div>`)}</dl><div class="inf-summary__total"><span class="inf-summary__label">${totalLabel}</span><span class="inf-summary__usd" data-summary="total">${total}</span></div>${parts ? html`<p class="inf-sub" data-summary="parts">${parts}</p>` : ''}${action ?? ''}${footnote ? html`<p class="inf-summary__foot">${footnote}</p>` : ''}</aside>`;
