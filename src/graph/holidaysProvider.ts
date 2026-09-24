// [[C23]] calcModes
// Nager.Date public holidays (keyless, CORS-open). URL builds and parses are pure; the node owns fetch and cache.
import { type FrameValue, type FrameColumn } from "./frame";
import { parseDateToSerial } from "./nodes/dateSerial";

export interface Holiday {
  /** Excel date serial (UTC midnight). */
  serial: number;
  name: string;
  /** The country's own name for the day. */
  localName: string;
  /** Subdivision codes the day is limited to (for example "US-CA"); [] = nationwide. */
  counties: string[];
}

export function holidaysUrl(year: number, country: string): string {
  const y = Math.trunc(year);
  return `https://date.nager.at/api/v3/PublicHolidays/${y}/${encodeURIComponent(country.trim().toUpperCase())}`;
}

/** In the API's order, already date-ascending; a malformed body, a non-array or an undated row is dropped. */
export function parseHolidays(text: string): Holiday[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: Holiday[] = [];
  for (const r of data) {
    const o = r as Record<string, unknown>;
    if (typeof o.date !== "string") continue;
    const serial = parseDateToSerial(o.date);
    if (!Number.isFinite(serial)) continue;
    out.push({
      serial,
      name: typeof o.name === "string" ? o.name : "",
      localName: typeof o.localName === "string" ? o.localName : "",
      counties: Array.isArray(o.counties)
        ? (o.counties as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
    });
  }
  return out;
}

/** A blank region keeps every day; a nationwide day always applies, a subdivision day only when the region is listed. */
export function filterHolidays(holidays: readonly Holiday[], region: string): Holiday[] {
  const r = region.trim();
  if (r === "") return [...holidays];
  return holidays.filter((h) => h.counties.length === 0 || h.counties.includes(r));
}

export function holidaysFrame(holidays: readonly Holiday[]): FrameValue {
  const columns: FrameColumn[] = [
    { name: "Date", type: "date", values: holidays.map((h) => h.serial) },
    { name: "Name", type: "string", values: holidays.map((h) => h.name || null) },
    { name: "Local", type: "string", values: holidays.map((h) => h.localName || null) },
  ];
  return { __frame: true, columns };
}

/** Today itself is 0; null when none remain. Both serials are UTC midnight, so the difference is whole days. */
export function daysToNextHoliday(holidays: readonly Holiday[], todaySerial: number): number | null {
  let best: number | null = null;
  for (const h of holidays) {
    const d = Math.round(h.serial - todaySerial);
    if (d >= 0 && (best === null || d < best)) best = d;
  }
  return best;
}

// A bundled copy of Nager.Date's AvailableCountries (v3), so the picker spends no fetch on a list that rarely changes.
const COUNTRY_TSV = `AD Andorra
AG Antigua and Barbuda
AI Anguilla
AL Albania
AM Armenia
AO Angola
AR Argentina
AT Austria
AU Australia
AW Aruba
AX Åland Islands
BA Bosnia and Herzegovina
BB Barbados
BD Bangladesh
BE Belgium
BF Burkina Faso
BG Bulgaria
BH Bahrain
BI Burundi
BJ Benin
BL Saint Barthélemy
BM Bermuda
BO Bolivia
BQ Caribbean Netherlands
BR Brazil
BS Bahamas
BW Botswana
BY Belarus
BZ Belize
CA Canada
CC Cocos (Keeling) Islands
CD DR Congo
CF Central African Republic
CG Congo
CH Switzerland
CI Ivory Coast
CK Cook Islands
CL Chile
CM Cameroon
CN China
CO Colombia
CR Costa Rica
CU Cuba
CV Cape Verde
CW Curaçao
CX Christmas Island
CY Cyprus
CZ Czechia
DE Germany
DJ Djibouti
DK Denmark
DM Dominica
DO Dominican Republic
DZ Algeria
EC Ecuador
EE Estonia
EG Egypt
ER Eritrea
ES Spain
ET Ethiopia
FI Finland
FK Falkland Islands
FM Micronesia
FO Faroe Islands
FR France
GA Gabon
GB United Kingdom
GD Grenada
GE Georgia
GF French Guiana
GG Guernsey
GH Ghana
GI Gibraltar
GL Greenland
GM Gambia
GN Guinea
GP Guadeloupe
GQ Equatorial Guinea
GR Greece
GT Guatemala
GW Guinea-Bissau
GY Guyana
HK Hong Kong
HN Honduras
HR Croatia
HT Haiti
HU Hungary
ID Indonesia
IE Ireland
IM Isle of Man
IQ Iraq
IS Iceland
IT Italy
JE Jersey
JM Jamaica
JP Japan
KE Kenya
KH Cambodia
KI Kiribati
KM Comoros
KN Saint Kitts and Nevis
KR South Korea
KY Cayman Islands
KZ Kazakhstan
LC Saint Lucia
LI Liechtenstein
LR Liberia
LS Lesotho
LT Lithuania
LU Luxembourg
LV Latvia
LY Libya
MA Morocco
MC Monaco
MD Moldova
ME Montenegro
MF Saint Martin
MG Madagascar
MH Marshall Islands
MK North Macedonia
ML Mali
MN Mongolia
MP Northern Mariana Islands
MQ Martinique
MR Mauritania
MS Montserrat
MT Malta
MW Malawi
MX Mexico
MZ Mozambique
NA Namibia
NC New Caledonia
NE Niger
NF Norfolk Island
NG Nigeria
NI Nicaragua
NL Netherlands
NO Norway
NR Nauru
NU Niue
NZ New Zealand
PA Panama
PE Peru
PF French Polynesia
PG Papua New Guinea
PH Philippines
PL Poland
PM Saint Pierre and Miquelon
PN Pitcairn Islands
PR Puerto Rico
PT Portugal
PW Palau
PY Paraguay
RO Romania
RS Serbia
RU Russia
RW Rwanda
SB Solomon Islands
SC Seychelles
SD Sudan
SE Sweden
SG Singapore
SH Saint Helena, Ascension and Tristan da Cunha
SI Slovenia
SJ Svalbard and Jan Mayen
SK Slovakia
SL Sierra Leone
SM San Marino
SN Senegal
SO Somalia
SR Suriname
SS South Sudan
ST São Tomé and Príncipe
SV El Salvador
SX Sint Maarten
SY Syria
SZ Eswatini
TC Turks and Caicos Islands
TD Chad
TG Togo
TK Tokelau
TN Tunisia
TO Tonga
TR Türkiye
TT Trinidad and Tobago
TV Tuvalu
TZ Tanzania
UA Ukraine
UG Uganda
US United States
UY Uruguay
VA Vatican City
VC Saint Vincent and the Grenadines
VE Venezuela
VG British Virgin Islands
VI United States Virgin Islands
VN Vietnam
VU Vanuatu
WF Wallis and Futuna
WS Samoa
YE Yemen
ZA South Africa
ZM Zambia
ZW Zimbabwe`;

export interface Country { code: string; name: string; }

export const NAGER_COUNTRIES: Country[] = COUNTRY_TSV.trim().split("\n").map((line) => {
  const i = line.indexOf(" ");
  return { code: line.slice(0, i), name: line.slice(i + 1) };
});
