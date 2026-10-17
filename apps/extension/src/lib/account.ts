import { z } from 'zod';

/**
 * The website account is a local profile: a name, an email and a profile type kept in the browser that created it.
 * There is no password and no server. "Connecting" means the website proposes these three standard facts to the
 * installed extension, which asks the user to confirm them before saving.
 */
export const PROFILE_TYPES = ['Student', 'Job seeker', 'Professional'] as const;

export const AccountSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80),
  email: z.string().trim().email('Enter a valid email.').max(254),
  profile: z.union([z.enum(PROFILE_TYPES), z.literal('')]).default(''),
});
export type Account = z.infer<typeof AccountSchema>;

export const ACCOUNT_STORAGE_KEY = 'a2c_web_account';
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
export const ACCOUNT_KEYS = ['preferred_name', 'email', 'profile_type'] as const;

/** Extension id passed in the page address, e.g. `#account?ext=<id>`. Anything else is ignored. */
export function parseExtensionId(hash: string): string | null {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const id = new URLSearchParams(query).get('ext');
  return id && EXTENSION_ID_PATTERN.test(id) ? id : null;
}

export interface AccountFact {
  key: (typeof ACCOUNT_KEYS)[number];
  label: string;
  value: string;
}

/** The facts an account proposes to the extension. Empty values are left out. */
export function accountFacts(account: Account): AccountFact[] {
  const facts: AccountFact[] = [
    { key: 'preferred_name', label: 'Preferred name', value: account.name },
    { key: 'email', label: 'Email', value: account.email },
  ];
  if (account.profile) facts.push({ key: 'profile_type', label: 'Profile type', value: account.profile });
  return facts;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}
