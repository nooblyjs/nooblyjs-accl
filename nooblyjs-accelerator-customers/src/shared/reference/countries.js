/**
 * @fileoverview ISO 3166-1 alpha-2 country codes with names and ITU calling
 * codes. Used for address country validation and E.164 phone normalisation.
 *
 * Format per entry: `CODE:Name:callingCode` (calling code without `+`).
 *
 * @author NooblyJS Team
 * @since 0.2.0
 */

'use strict';

const RAW = `AD:Andorra:376|AE:United Arab Emirates:971|AF:Afghanistan:93|AG:Antigua and Barbuda:1268|AI:Anguilla:1264|AL:Albania:355|AM:Armenia:374|AO:Angola:244|AQ:Antarctica:672|AR:Argentina:54|AS:American Samoa:1684|AT:Austria:43|AU:Australia:61|AW:Aruba:297|AX:Åland Islands:358|AZ:Azerbaijan:994|BA:Bosnia and Herzegovina:387|BB:Barbados:1246|BD:Bangladesh:880|BE:Belgium:32|BF:Burkina Faso:226|BG:Bulgaria:359|BH:Bahrain:973|BI:Burundi:257|BJ:Benin:229|BL:Saint Barthélemy:590|BM:Bermuda:1441|BN:Brunei:673|BO:Bolivia:591|BQ:Caribbean Netherlands:599|BR:Brazil:55|BS:Bahamas:1242|BT:Bhutan:975|BV:Bouvet Island:47|BW:Botswana:267|BY:Belarus:375|BZ:Belize:501|CA:Canada:1|CC:Cocos (Keeling) Islands:61|CD:Congo (DRC):243|CF:Central African Republic:236|CG:Congo:242|CH:Switzerland:41|CI:Côte d'Ivoire:225|CK:Cook Islands:682|CL:Chile:56|CM:Cameroon:237|CN:China:86|CO:Colombia:57|CR:Costa Rica:506|CU:Cuba:53|CV:Cabo Verde:238|CW:Curaçao:599|CX:Christmas Island:61|CY:Cyprus:357|CZ:Czechia:420|DE:Germany:49|DJ:Djibouti:253|DK:Denmark:45|DM:Dominica:1767|DO:Dominican Republic:1809|DZ:Algeria:213|EC:Ecuador:593|EE:Estonia:372|EG:Egypt:20|EH:Western Sahara:212|ER:Eritrea:291|ES:Spain:34|ET:Ethiopia:251|FI:Finland:358|FJ:Fiji:679|FK:Falkland Islands:500|FM:Micronesia:691|FO:Faroe Islands:298|FR:France:33|GA:Gabon:241|GB:United Kingdom:44|GD:Grenada:1473|GE:Georgia:995|GF:French Guiana:594|GG:Guernsey:44|GH:Ghana:233|GI:Gibraltar:350|GL:Greenland:299|GM:Gambia:220|GN:Guinea:224|GP:Guadeloupe:590|GQ:Equatorial Guinea:240|GR:Greece:30|GS:South Georgia:500|GT:Guatemala:502|GU:Guam:1671|GW:Guinea-Bissau:245|GY:Guyana:592|HK:Hong Kong:852|HM:Heard and McDonald Islands:672|HN:Honduras:504|HR:Croatia:385|HT:Haiti:509|HU:Hungary:36|ID:Indonesia:62|IE:Ireland:353|IL:Israel:972|IM:Isle of Man:44|IN:India:91|IO:British Indian Ocean Territory:246|IQ:Iraq:964|IR:Iran:98|IS:Iceland:354|IT:Italy:39|JE:Jersey:44|JM:Jamaica:1876|JO:Jordan:962|JP:Japan:81|KE:Kenya:254|KG:Kyrgyzstan:996|KH:Cambodia:855|KI:Kiribati:686|KM:Comoros:269|KN:Saint Kitts and Nevis:1869|KP:North Korea:850|KR:South Korea:82|KW:Kuwait:965|KY:Cayman Islands:1345|KZ:Kazakhstan:7|LA:Laos:856|LB:Lebanon:961|LC:Saint Lucia:1758|LI:Liechtenstein:423|LK:Sri Lanka:94|LR:Liberia:231|LS:Lesotho:266|LT:Lithuania:370|LU:Luxembourg:352|LV:Latvia:371|LY:Libya:218|MA:Morocco:212|MC:Monaco:377|MD:Moldova:373|ME:Montenegro:382|MF:Saint Martin:590|MG:Madagascar:261|MH:Marshall Islands:692|MK:North Macedonia:389|ML:Mali:223|MM:Myanmar:95|MN:Mongolia:976|MO:Macao:853|MP:Northern Mariana Islands:1670|MQ:Martinique:596|MR:Mauritania:222|MS:Montserrat:1664|MT:Malta:356|MU:Mauritius:230|MV:Maldives:960|MW:Malawi:265|MX:Mexico:52|MY:Malaysia:60|MZ:Mozambique:258|NA:Namibia:264|NC:New Caledonia:687|NE:Niger:227|NF:Norfolk Island:672|NG:Nigeria:234|NI:Nicaragua:505|NL:Netherlands:31|NO:Norway:47|NP:Nepal:977|NR:Nauru:674|NU:Niue:683|NZ:New Zealand:64|OM:Oman:968|PA:Panama:507|PE:Peru:51|PF:French Polynesia:689|PG:Papua New Guinea:675|PH:Philippines:63|PK:Pakistan:92|PL:Poland:48|PM:Saint Pierre and Miquelon:508|PN:Pitcairn Islands:64|PR:Puerto Rico:1787|PS:Palestine:970|PT:Portugal:351|PW:Palau:680|PY:Paraguay:595|QA:Qatar:974|RE:Réunion:262|RO:Romania:40|RS:Serbia:381|RU:Russia:7|RW:Rwanda:250|SA:Saudi Arabia:966|SB:Solomon Islands:677|SC:Seychelles:248|SD:Sudan:249|SE:Sweden:46|SG:Singapore:65|SH:Saint Helena:290|SI:Slovenia:386|SJ:Svalbard and Jan Mayen:47|SK:Slovakia:421|SL:Sierra Leone:232|SM:San Marino:378|SN:Senegal:221|SO:Somalia:252|SR:Suriname:597|SS:South Sudan:211|ST:São Tomé and Príncipe:239|SV:El Salvador:503|SX:Sint Maarten:1721|SY:Syria:963|SZ:Eswatini:268|TC:Turks and Caicos Islands:1649|TD:Chad:235|TF:French Southern Territories:262|TG:Togo:228|TH:Thailand:66|TJ:Tajikistan:992|TK:Tokelau:690|TL:Timor-Leste:670|TM:Turkmenistan:993|TN:Tunisia:216|TO:Tonga:676|TR:Türkiye:90|TT:Trinidad and Tobago:1868|TV:Tuvalu:688|TW:Taiwan:886|TZ:Tanzania:255|UA:Ukraine:380|UG:Uganda:256|UM:U.S. Outlying Islands:1|US:United States:1|UY:Uruguay:598|UZ:Uzbekistan:998|VA:Vatican City:39|VC:Saint Vincent and the Grenadines:1784|VE:Venezuela:58|VG:British Virgin Islands:1284|VI:U.S. Virgin Islands:1340|VN:Vietnam:84|VU:Vanuatu:678|WF:Wallis and Futuna:681|WS:Samoa:685|YE:Yemen:967|YT:Mayotte:262|ZA:South Africa:27|ZM:Zambia:260|ZW:Zimbabwe:263`;

/** @type {Readonly<Object<string, {code: string, name: string, dial: string}>>} */
const COUNTRIES = Object.freeze(Object.fromEntries(RAW.split('|').map((entry) => {
  const [code, name, dial] = entry.split(':');
  return [code, Object.freeze({ code, name, dial })];
})));

/** Countries whose national format keeps the leading 0 after the country code. */
const KEEPS_TRUNK_ZERO = new Set(['IT', 'VA', 'SM']);

/**
 * Preferred country for a shared calling code when the number alone cannot tell.
 * NANP (+1) numbers are attributed by area code where listed above; otherwise US.
 */
const DIAL_DEFAULTS = Object.freeze({ 1: 'US', 7: 'RU', 44: 'GB', 47: 'NO', 61: 'AU', 262: 'RE', 290: 'SH', 358: 'FI', 39: 'IT', 500: 'FK', 590: 'GP', 599: 'CW', 672: 'NF', 64: 'NZ', 212: 'MA' });

/**
 * @param {string} code - Candidate ISO 3166-1 alpha-2 code
 * @return {boolean} Whether it is a known country
 */
function isCountryCode(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(COUNTRIES, code.toUpperCase());
}

/**
 * Finds the country for an E.164 number (longest matching calling code).
 *
 * @param {string} e164 - `+` followed by digits
 * @param {string} [hint] - Preferred country when several share the code
 * @return {?string} ISO 3166-1 alpha-2 code
 */
function countryForE164(e164, hint) {
  const digits = String(e164).replace(/^\+/, '');
  if (hint && isCountryCode(hint) && digits.startsWith(COUNTRIES[hint.toUpperCase()].dial)) return hint.toUpperCase();
  for (let len = 4; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    const matches = Object.values(COUNTRIES).filter((c) => c.dial === prefix);
    if (matches.length === 1) return matches[0].code;
    if (matches.length > 1) return DIAL_DEFAULTS[prefix] || matches[0].code;
  }
  return null;
}

module.exports = { COUNTRIES, KEEPS_TRUNK_ZERO, isCountryCode, countryForE164 };
