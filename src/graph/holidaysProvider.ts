// [[C23]] calcModes
// Nager.Date public holidays (keyless, CORS-open). The node owns fetch and cache; the core reads the reply.
import { type FrameValue } from "./frame";
import { frameFnOnCore } from "./frameBackend";

export function holidaysUrl(year: number, country: string): string {
  const y = Math.trunc(year);
  return `https://date.nager.at/api/v3/PublicHolidays/${y}/${encodeURIComponent(country.trim().toUpperCase())}`;
}

/** The holidays that apply in `region` (blank: every day; else the nationwide ones and that subdivision's), a row each,
 *  read on the core (`providers.rs`); and the whole days from `todaySerial` to the next, or null when none remain. */
export function holidaysOnCore(text: string, region: string, todaySerial: number): { frame: FrameValue; next: number | null } {
  const r = frameFnOnCore("holidaysFrame", [], [text, region, todaySerial]);
  return r && "frame" in r ? { frame: r.frame, next: r.value as number | null } : { frame: { __frame: true, columns: [] }, next: null };
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
