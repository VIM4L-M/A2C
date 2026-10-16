import { z } from 'zod';

/**
 * Browser-local encrypted vault for private memory facts.
 *
 *  - Key derivation: PBKDF2-SHA-256, 600,000 iterations, 16-byte random salt per vault.
 *  - Encryption: AES-GCM 256, fresh 12-byte random IV on every save.
 *  - The derived CryptoKey is non-extractable and lives only in the side panel's
 *    memory while unlocked. The passphrase and plaintext are never persisted.
 *  - Losing the passphrase means the vault cannot be recovered.
 */

export const VAULT_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode('a2c-vault-v1');

export const VaultRecordSchema = z.object({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(100_000),
  salt: z.string(),
  iv: z.string(),
  ciphertext: z.string(),
});
export type VaultRecord = z.infer<typeof VaultRecordSchema>;

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: 'wrong_passphrase' | 'weak_passphrase' | 'corrupt',
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function checkPassphrase(passphrase: string): string | null {
  if (passphrase.length < 10) return 'Use at least 10 characters';
  if (new Set(passphrase).size < 5) return 'Use a less repetitive passphrase';
  return null;
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = VAULT_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(key: CryptoKey, salt: string, iterations: number, plaintext: unknown): Promise<VaultRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, data));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt, iv: toB64(iv), ciphertext: toB64(ct) };
}

export async function open(key: CryptoKey, record: VaultRecord): Promise<unknown> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(record.iv), additionalData: AAD }, key, fromB64(record.ciphertext));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new VaultError('Wrong passphrase or corrupted vault', 'wrong_passphrase');
  }
}

export async function createVault(passphrase: string, initial: unknown): Promise<{ key: CryptoKey; record: VaultRecord }> {
  const weak = checkPassphrase(passphrase);
  if (weak) throw new VaultError(weak, 'weak_passphrase');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const record = await seal(key, toB64(salt), VAULT_ITERATIONS, initial);
  return { key, record };
}

export async function unlockVault(passphrase: string, raw: unknown): Promise<{ key: CryptoKey; plaintext: unknown }> {
  const parsed = VaultRecordSchema.safeParse(raw);
  if (!parsed.success) throw new VaultError('Vault data is corrupted', 'corrupt');
  const key = await deriveKey(passphrase, fromB64(parsed.data.salt), parsed.data.iterations);
  const plaintext = await open(key, parsed.data);
  return { key, plaintext };
}
