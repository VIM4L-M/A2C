import { buildMappingRequest, buildProposals, deterministicMap } from '@a2c/shared';
import { describe, expect, it } from 'vitest';
import { memoryKV, STORAGE_KEYS } from '../apps/extension/src/lib/storage';
import { prepareFact } from '../apps/extension/src/memory/facts';
import { MemoryStore } from '../apps/extension/src/memory/store';
import { createVault, unlockVault, VaultError } from '../apps/extension/src/memory/vault';
import { DEMO_FACTS, field, scanOf } from './helpers';

describe('saving facts (consent + secret filtering)', () => {
  it('refuses credential-like keys regardless of value', () => {
    for (const [key, label] of [
      ['password', 'Password'],
      ['otp', 'OTP'],
      ['card_number', 'Card number'],
      ['cvv', 'CVV'],
      ['api_key', 'API key'],
    ]) {
      const r = prepareFact({ key: key!, label, value: 'whatever', source: 'manual' });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses secret-like values even behind a harmless label', () => {
    expect(prepareFact({ key: 'nickname', label: 'Nickname', value: '4111 1111 1111 1111', source: 'form_approved' }).ok).toBe(false);
    expect(prepareFact({ key: 'favourite_quote', label: 'Favourite quote', value: 'gh' + 'p_abcdefghijklmnopqrstuvwxyz0123456789', source: 'form_approved' }).ok).toBe(false);
    expect(prepareFact({ key: 'verification', label: 'Verification code', value: '482913', source: 'form_approved' }).ok).toBe(false);
  });

  it('records provenance and keeps catalog sensitivity', () => {
    const r = prepareFact({ key: 'graduation_year', value: '2028', source: 'form_approved', domain: 'hackfest.example' });
    expect(r.ok && r.fact).toMatchObject({ sensitivity: 'standard', permission: 'auto', provenance: { source: 'form_approved', domain: 'hackfest.example' } });
    expect(r.ok && r.needsExtraConfirm).toBe(false);
  });

  it('amber facts become private and need extra confirmation', () => {
    const phone = prepareFact({ key: 'phone', value: '+91 98765 43210', source: 'form_approved' });
    expect(phone.ok && phone.fact.sensitivity).toBe('private');
    expect(phone.ok && phone.needsExtraConfirm).toBe(true);
    const custom = prepareFact({ key: 'blood_group', label: 'Blood group', value: 'O+', source: 'manual' });
    expect(custom.ok && custom.fact.sensitivity).toBe('private');
  });
});

describe('no silent memory updates', () => {
  it('scanning and mapping never write to storage', async () => {
    const kv = memoryKV();
    const store = new MemoryStore(kv);
    await store.load();
    for (const f of DEMO_FACTS) await store.upsert(f);
    const before = JSON.stringify(kv.data);
    const fields = [field({ label: 'Full Name' }), field({ label: 'Expected Graduation Year' }), field({ label: 'T-shirt size' })];
    const scan = scanOf(fields);
    const req = buildMappingRequest(scan, store.facts())!;
    buildProposals(deterministicMap(req), {
      scan,
      facts: new Map(store.facts().map((f) => [f.key, f])),
      offeredKeys: new Set(req.availableMemoryKeys.map((k) => k.key)),
      domain: 'x.example',
      source: 'mock',
    });
    expect(JSON.stringify(kv.data)).toBe(before);
  });
});

describe('encrypted vault', () => {
  it('round-trips with the right passphrase and stores no plaintext', async () => {
    const kv = memoryKV();
    const store = new MemoryStore(kv);
    await store.load();
    await store.createVault('correct horse battery');
    const r = prepareFact({ key: 'phone', value: '+91 98765 43210', source: 'manual' });
    if (!r.ok) throw new Error(r.error);
    await store.upsert(r.fact);
    const raw = JSON.stringify(kv.data);
    expect(raw).not.toContain('98765');
    expect(JSON.stringify(kv.data[STORAGE_KEYS.memory] ?? [])).not.toContain('phone');

    const reopened = new MemoryStore(kv);
    await reopened.load();
    expect(reopened.vaultState).toBe('locked');
    expect(reopened.facts()).toHaveLength(0);
    await expect(reopened.unlock('wrong passphrase!!')).rejects.toBeInstanceOf(VaultError);
    await reopened.unlock('correct horse battery');
    expect(reopened.facts().find((f) => f.key === 'phone')?.value).toBe('+91 98765 43210');
    reopened.lock();
    expect(reopened.facts()).toHaveLength(0);
  });

  it('refuses private facts while locked and weak passphrases', async () => {
    const store = new MemoryStore(memoryKV());
    await store.load();
    const r = prepareFact({ key: 'phone', value: '+1 555 0100', source: 'manual' });
    if (!r.ok) throw new Error(r.error);
    await expect(store.upsert(r.fact)).rejects.toBeInstanceOf(VaultError);
    await expect(createVault('short', [])).rejects.toBeInstanceOf(VaultError);
  });

  it('uses a fresh IV on every save', async () => {
    const { key, record } = await createVault('another good passphrase', []);
    const { plaintext } = await unlockVault('another good passphrase', record);
    expect(plaintext).toEqual([]);
    const { seal } = await import('../apps/extension/src/memory/vault');
    const a = await seal(key, record.salt, record.iterations, [1]);
    const b = await seal(key, record.salt, record.iterations, [1]);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
