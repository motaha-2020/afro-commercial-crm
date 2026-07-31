export const LOCALES = ['ar', 'en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

/** Countries Afro Group operates in, per the spec. */
export const COUNTRIES = ['EG', 'MG', 'KM', 'KE'] as const;
export type Country = (typeof COUNTRIES)[number];

export const CURRENCIES = ['USD', 'EGP', 'EUR', 'MGA', 'KES', 'KMF'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Business domains seen across Afro's opportunity portfolio. */
export const INDUSTRIES = [
  'FTTH',
  'FTTS',
  'WIRELESS',
  'FIXED',
  'SUBMARINE',
  'MEP',
  'ELV',
  'CORE_NETWORK',
  'IT',
  'SUPPLY',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const ACCOUNT_TYPES = [
  'OPERATOR',
  'CONTRACTOR',
  'GOVERNMENT',
  'ENTERPRISE',
  'DEVELOPER',
  'VENDOR',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CREDIT_STATUSES = ['GOOD', 'WATCH', 'HOLD', 'BLOCKED'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const LEAD_SOURCES = [
  'TENDER_PORTAL',
  'DIRECT_INVITATION',
  'REFERRAL',
  'EXISTING_CLIENT',
  'MARKETING',
  'PARTNER',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
