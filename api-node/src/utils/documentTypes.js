/**
 * Employee document types and which ones are required for which work-authorization status.
 *
 * These are sensible defaults for a US IT staffing company. Have your immigration attorney
 * review REQUIRED_BY_STATUS before relying on it; edit this file to change the rules.
 */
const DOC_TYPES = {
  // Identity & immigration
  PASSPORT:    { label: 'Passport', category: 'Immigration', expires: true, numberLabel: 'Passport number' },
  VISA_STAMP:  { label: 'Visa stamp (copy from passport)', category: 'Immigration', expires: true, numberLabel: 'Visa foil number' },
  I94:         { label: 'I-94 arrival record', category: 'Immigration', expires: true, numberLabel: 'I-94 number' },
  I797:        { label: 'I-797 approval notice (H-1B / L-1)', category: 'Immigration', expires: true, numberLabel: 'Receipt number' },
  LCA:         { label: 'LCA (certified ETA-9035)', category: 'Immigration', expires: true, numberLabel: 'LCA case number' },
  EAD:         { label: 'EAD card', category: 'Immigration', expires: true, numberLabel: 'Card number' },
  I20:         { label: 'I-20', category: 'Immigration', expires: true, numberLabel: 'SEVIS ID' },
  I983:        { label: 'I-983 training plan (STEM OPT)', category: 'Immigration', expires: false },
  GREEN_CARD:  { label: 'Green card', category: 'Immigration', expires: true, numberLabel: 'Card number' },
  H4_I797:     { label: 'Spouse I-797 (H-4)', category: 'Immigration', expires: true, numberLabel: 'Receipt number' },
  // Employment
  OFFER_LETTER:  { label: 'Offer letter / employment agreement', category: 'Employment', expires: false },
  I9:            { label: 'Form I-9', category: 'Employment', expires: false },
  W4:            { label: 'Form W-4', category: 'Employment', expires: false },
  SSN_CARD:      { label: 'Social Security card', category: 'Employment', expires: false, numberLabel: 'Last 4 digits only' },
  DRIVERS_LICENSE: { label: "Driver's licence / state ID", category: 'Employment', expires: true, numberLabel: 'Licence number' },
  // Profile
  RESUME:      { label: 'Résumé', category: 'Profile', expires: false },
  DEGREE:      { label: 'Degree certificate / transcripts', category: 'Profile', expires: false },
  OTHER:       { label: 'Other', category: 'Other', expires: false },
};

// Everyone needs these
const BASE_REQUIRED = ['OFFER_LETTER', 'I9', 'RESUME'];

// Extra documents by visa / status (matched on the employee's latest immigration record)
const REQUIRED_BY_STATUS = {
  H1B: ['PASSPORT', 'VISA_STAMP', 'I94', 'I797', 'LCA'],
  L1: ['PASSPORT', 'VISA_STAMP', 'I94', 'I797'],
  OPT: ['PASSPORT', 'EAD', 'I20', 'I94'],
  STEMOPT: ['PASSPORT', 'EAD', 'I20', 'I983', 'I94'],
  H4EAD: ['PASSPORT', 'EAD', 'I94', 'H4_I797'],
  GCEAD: ['PASSPORT', 'EAD'],
  GC: ['GREEN_CARD'],
  GREENCARD: ['GREEN_CARD'],
  TN: ['PASSPORT', 'I94'],
  E3: ['PASSPORT', 'VISA_STAMP', 'I94', 'LCA'],
  CITIZEN: [],
  USC: [],
};
// Any other visa type on file
const DEFAULT_VISA_REQUIRED = ['PASSPORT', 'VISA_STAMP', 'I94'];

/** 'STEM-OPT' -> 'STEMOPT', 'L-1A' -> 'L1' */
function normalizeStatus(visaType) {
  const k = String(visaType || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.startsWith('L1')) return 'L1';
  if (k.startsWith('H1B')) return 'H1B';
  return k;
}

/** Required document types for an employee's latest visa type (null/empty = no visa on file) */
function requiredFor(visaType) {
  if (!visaType) return [...BASE_REQUIRED];
  const extra = REQUIRED_BY_STATUS[normalizeStatus(visaType)] ?? DEFAULT_VISA_REQUIRED;
  return [...new Set([...BASE_REQUIRED, ...extra])];
}

module.exports = { DOC_TYPES, requiredFor };
