import type { Classification, FieldSignals } from '../types';
import { normalizeText } from './normalize';

/**
 * Deterministic, conservative field risk classifier.
 *
 * Runs locally BEFORE any model call. Its decision cannot be overridden by the
 * model: red fields are never filled, their values are never read, and their
 * labels are never sent to inference.
 *
 *   red   - credentials / payment / secrets: blocked, left to the browser.
 *   gray  - unknown, legal, captcha, signature, suspicious, unsupported.
 *   amber - personal / sensitive: requires explicit per-field approval.
 *   green - ordinary reusable profile data: auto candidate.
 */

interface Rule {
  rule: string;
  reason: string;
  re: RegExp;
}

const RED_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|webauthn|cc-[a-z-]+)$/;

export const RED_RULES: Rule[] = [
  { rule: 'password', reason: 'Password or passcode field', re: /\b(pass ?words?|passwd|pwd|pass ?codes?|pass ?phrases?)\b/ },
  { rule: 'pin', reason: 'PIN for an account or card', re: /\b(pin|mpin|atm pin|upi pin|card pin)\b(?! ?code)/ },
  {
    rule: 'otp',
    reason: 'One-time or verification code',
    re: /\b(otp|one ?time (pass(word)?|code|pin)|verification code|verify code|auth(entication|orization)? code|security code|sms code|email code|2fa|mfa|totp|two factor|2 step|two step|access code|confirmation code|enter (the )?code|\d digit code)\b/,
  },
  { rule: 'card_security', reason: 'Card security code (CVV/CVC)', re: /\b(cvv2?|cvc2?|csc|cvn|card verification|card security)\b/ },
  {
    rule: 'card_number',
    reason: 'Payment card number',
    re: /\b(card ?(number|no|num)|credit ?card|debit ?card|cc ?(num|number|no)|ccnum|payment card|name on card|cardholder)\b/,
  },
  {
    rule: 'card_expiry',
    reason: 'Payment card expiry',
    re: /\b(card expiry|card expiration|expir(y|ation) (date|month|year)|exp (date|month|year)|valid thru|mm yy)\b/,
  },
  {
    rule: 'bank_account',
    reason: 'Bank account or financial authentication',
    re: /\b(account number|acct ?(no|num|number)|routing number|sort code|iban|swift code|bank account|net ?banking|upi id|wallet address)\b/,
  },
  {
    rule: 'secret',
    reason: 'API key, token or private key',
    re: /\b(api ?keys?|apikey|secret ?keys?|client ?secret|private ?keys?|access ?tokens?|auth ?tokens?|bearer|refresh ?token|session ?token|ssh ?key|signing key|secrets?|tokens?|passkeys?|webauthn|security key)\b/,
  },
  {
    rule: 'recovery',
    reason: 'Recovery code or seed phrase',
    re: /\b(recovery (code|key|phrase)s?|backup codes?|seed phrase|mnemonic|wallet phrase|secret phrase)\b/,
  },
  {
    rule: 'security_question',
    reason: 'Account security question',
    re: /\b(security (question|answer)|secret (question|answer)|maiden name)\b/,
  },
];

const INJECTION_RE = new RegExp(
  [
    'ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)',
    'disregard (the |all )?(previous|prior|above|rules|instructions)',
    'system prompt',
    'you are (now )?(an? )?(ai|assistant|language model|chatgpt|gemma|model)',
    'override (the )?(rules|policy|safety)',
    'new instructions',
    '</?(system|instruction|prompt)',
    'assistant:',
    'exfiltrat',
    'send (it|this|the data|all data|everything) to',
    'fill (in )?(the |my )?(password|card|otp|cvv|secret)',
    'reveal (the |your )?(memory|profile|secrets)',
    '(output|print|dump) (all |the )?memory',
  ].join('|'),
);

const GRAY_RULES: Rule[] = [
  {
    rule: 'captcha',
    reason: 'CAPTCHA / human verification',
    re: /\b(captcha|recaptcha|hcaptcha|not a robot|human verification|prove you are human)\b/,
  },
  { rule: 'signature', reason: 'Signature or initials', re: /\b(e ?sign(ature)?|signatures?|sign here|initials|digital signature)\b/ },
  {
    rule: 'legal',
    reason: 'Legal acceptance or binding declaration',
    re: /\b(i agree|agree to|accept (the )?(terms|policy|conditions)|terms (of|and) (service|use|conditions)|privacy policy|i (hereby )?(certify|declare|confirm|acknowledge|authori[sz]e|consent|attest|understand)|consent|declaration|under penalty|legally binding|code of conduct)\b/,
  },
];

const AMBER_RULES: Rule[] = [
  { rule: 'contact_phone', reason: 'Phone number', re: /\b(phone|mobile|cell|telephone|whats ?app|contact (number|no)|tel)\b/ },
  { rule: 'contact_email', reason: 'Email address (approve per site)', re: /\b(e ?mail|email address|mail id)\b/ },
  {
    rule: 'address',
    reason: 'Home or postal address',
    re: /\b(address|street|city|town|zip|postal|post code|postcode|pincode|pin code|landmark|house|apartment|apt|district|province)\b/,
  },
  { rule: 'dob', reason: 'Date of birth / age', re: /\b(date of birth|dob|birth ?day|birth ?date|born|age)\b/ },
  { rule: 'grades', reason: 'Grades or academic scores', re: /\b(gpa|cgpa|sgpa|grades?|marks|percentage|score|class rank|transcript)\b/ },
  { rule: 'salary', reason: 'Salary or compensation', re: /\b(salary|ctc|compensation|pay|wages?|income|stipend|notice period)\b/ },
  {
    rule: 'government_id',
    reason: 'Government identifier',
    re: /\b(ssn|social security|aadhaa?r|pan card|pan number|passport|drivers? licen[cs]e|national id|tax id|tin|voter id|ein|uan|nin)\b/,
  },
  {
    rule: 'demographic_medical',
    reason: 'Medical or demographic information',
    re: /\b(gender|sex|race|ethnic(ity)?|religion|caste|disabilit(y|ies)|veteran|medical|health|allerg(y|ies)|blood group|pregnan(t|cy)|orientation|marital|nationality|citizenship|visa|work authori[sz]ation|criminal|conviction|pronouns?)\b/,
  },
  { rule: 'login_identity', reason: 'Login identifier', re: /\b(user ?name|login|user id|sign in)\b/ },
  {
    rule: 'third_party',
    reason: 'Information about another person',
    re: /\b(emergency contact|reference|referee|guardian|parent|father|mother|spouse|next of kin)\b/,
  },
  {
    rule: 'employment_sensitive',
    reason: 'Sensitive employment context',
    re: /\b(reason for leaving|current employer|previous employer|terminated|fired|background check)\b/,
  },
];

const FREE_TEXT_RE =
  /\b(why|tell us|describe|explain|motivation|cover letter|statement of purpose|about yourself|what makes you|what would you|how would you|essay|in (\d+ )?words|share (a|an|your))\b/;

function autocompleteTokens(ac: string | undefined): string[] {
  return (ac ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function firstMatch(rules: Rule[], text: string): Rule | undefined {
  return text ? rules.find((r) => r.re.test(text)) : undefined;
}

export function hasInjectionPattern(text: string | undefined): boolean {
  if (!text) return false;
  return INJECTION_RE.test(text.toLowerCase().replace(/\s+/g, ' '));
}

export function classifyField(signals: FieldSignals): Classification {
  const primary = normalizeText(
    [signals.label, signals.name, signals.id, signals.placeholder, signals.ariaDescription].filter(Boolean).join(' | '),
  );
  const nearby = normalizeText(signals.nearbyText);
  const ac = autocompleteTokens(signals.autocomplete);
  const inputType = (signals.inputType ?? '').toLowerCase();

  // 1. Hard credential signals from the platform itself.
  if (inputType === 'password') return { risk: 'red', reason: 'Password input', rule: 'input_password' };
  if (ac.some((t) => RED_AUTOCOMPLETE.test(t))) {
    return { risk: 'red', reason: 'Browser-managed credential or payment field', rule: 'autocomplete_secret' };
  }

  // 2. Credential / payment / secret wording in label, name, id, placeholder.
  const red = firstMatch(RED_RULES, primary);
  if (red) return { risk: 'red', reason: red.reason, rule: red.rule };

  // 3. Short numeric "code" boxes are treated as OTPs even with vague labels.
  if (/\bcode\b/.test(primary) && (signals.inputMode === 'numeric' || (signals.maxLength !== undefined && signals.maxLength <= 8))) {
    return { risk: 'red', reason: 'Short numeric code (likely one-time code)', rule: 'otp_shape' };
  }

  // 4. Surrounding text can only make a field stricter, never looser.
  const nearbyRed = firstMatch(
    RED_RULES.filter((r) => r.rule !== 'secret' && r.rule !== 'pin'),
    nearby,
  );
  if (nearbyRed) return { risk: 'red', reason: `${nearbyRed.reason} (from nearby text)`, rule: `nearby_${nearbyRed.rule}` };

  if (signals.kind === 'unsupported') return { risk: 'gray', reason: 'Unsupported input type', rule: 'unsupported_input' };

  // 5. Prompt-injection-like page text: never sent to the model.
  if ([signals.label, signals.placeholder, signals.ariaDescription, signals.nearbyText].some(hasInjectionPattern)) {
    return { risk: 'gray', reason: 'Instruction-like text near field; excluded from AI', rule: 'prompt_injection' };
  }

  const gray = firstMatch(GRAY_RULES, primary) ?? firstMatch(GRAY_RULES.filter((r) => r.rule !== 'legal'), nearby);
  if (gray) return { risk: 'gray', reason: gray.reason, rule: gray.rule };

  if (!primary) return { risk: 'gray', reason: 'Field has no identifiable label', rule: 'no_label' };

  if (signals.kind === 'checkbox' && (signals.optionLabels?.length ?? 0) <= 1) {
    return { risk: 'gray', reason: 'Single checkbox decisions stay with you', rule: 'single_checkbox' };
  }

  // 6. Personal / sensitive data needs explicit approval.
  if (inputType === 'tel' || ac.some((t) => t.startsWith('tel'))) return { risk: 'amber', reason: 'Phone number', rule: 'contact_phone' };
  if (inputType === 'email' || ac.includes('email')) {
    return { risk: 'amber', reason: 'Email address (approve per site)', rule: 'contact_email' };
  }
  if (ac.some((t) => /^(street-address|address-line\d|address-level\d|postal-code|bday.*|sex)$/.test(t))) {
    return { risk: 'amber', reason: 'Address, birthday or demographic field', rule: 'autocomplete_personal' };
  }
  const amber = firstMatch(AMBER_RULES, primary);
  if (amber) return { risk: 'amber', reason: amber.reason, rule: amber.rule };

  if (signals.kind === 'textarea' || FREE_TEXT_RE.test(primary)) {
    return { risk: 'amber', reason: 'Open-ended answer: draft needs your review', rule: 'free_text' };
  }

  return { risk: 'green', reason: 'General profile information', rule: 'general' };
}

/**
 * Classify a memory fact before it is written. Red keys/labels can never be
 * stored; amber ones are stored as private.
 */
export function classifyMemoryKey(key: string, label: string): Classification {
  return classifyField({ kind: 'text', name: key, label });
}
