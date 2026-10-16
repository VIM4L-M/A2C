/**
 * Value-level secret detection. Used before saving to memory, before filling
 * and on AI drafts, so that a misleading label cannot smuggle a credential
 * into storage.
 */

export interface SecretCheck {
  secret: boolean;
  reason: string;
}

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bASIA[0-9A-Z]{16}\b/, 'AWS session key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/, 'GitHub token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'GitLab token'],
  [/\bsk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{20,}\b/, 'API secret key'],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, 'payment API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, 'JSON web token'],
  [/\bhf_[A-Za-z0-9]{30,}\b/, 'Hugging Face token'],
];

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function detectSecretValue(value: string): SecretCheck {
  const v = value.trim();
  if (!v) return { secret: false, reason: '' };

  for (const [re, what] of TOKEN_PATTERNS) {
    if (re.test(v)) return { secret: true, reason: `Looks like a ${what}` };
  }

  // Payment card numbers anywhere in the value (13-19 digits, Luhn valid).
  for (const m of v.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      return { secret: true, reason: 'Looks like a payment card number' };
    }
  }

  // Long random-looking tokens without spaces.
  for (const word of v.split(/\s+/)) {
    if (word.length >= 32 && /^[A-Za-z0-9+/=_.-]+$/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word)) {
      if (!/^https?:/i.test(word) && shannonEntropy(word) >= 3.8) {
        return { secret: true, reason: 'Looks like a random access token' };
      }
    }
  }
  return { secret: false, reason: '' };
}

/** Short all-digit values in a code-like context are treated as one-time codes. */
export function looksLikeOneTimeCode(value: string, context: string): boolean {
  return /^\d{4,8}$/.test(value.trim()) && /\b(code|otp|pin|verification|token)\b/i.test(context);
}
