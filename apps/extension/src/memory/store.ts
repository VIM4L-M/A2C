import type { MemoryFact } from '@a2c/shared';
import { STORAGE_KEYS, type KV } from '../lib/storage';
import { FactListSchema } from './facts';
import { createVault, seal, unlockVault, VaultError, VaultRecordSchema, type VaultRecord } from './vault';

/**
 * Two-tier memory:
 *   standard facts -> chrome.storage.local (plaintext, NOT encrypted)
 *   private facts  -> AES-GCM vault (requires passphrase; decrypted only in memory)
 * Every write is explicit (Save to Memory); nothing is learned silently.
 */
export class MemoryStore {
  private vaultKey: CryptoKey | null = null;
  private vaultRecord: VaultRecord | null = null;
  private privateFacts: MemoryFact[] = [];
  private standardFacts: MemoryFact[] = [];

  constructor(private readonly kv: KV) {}

  async load(): Promise<void> {
    const raw = await this.kv.get(STORAGE_KEYS.memory);
    const parsed = FactListSchema.safeParse(raw ?? []);
    // Defensive: private facts must never sit in plaintext storage.
    this.standardFacts = parsed.success ? parsed.data.filter((f) => f.sensitivity === 'standard') : [];
    const v = VaultRecordSchema.safeParse(await this.kv.get(STORAGE_KEYS.vault));
    this.vaultRecord = v.success ? v.data : null;
  }

  get vaultState(): 'none' | 'locked' | 'unlocked' {
    if (!this.vaultRecord) return 'none';
    return this.vaultKey ? 'unlocked' : 'locked';
  }

  /** Facts currently usable (private ones only while unlocked). */
  facts(): MemoryFact[] {
    return [...this.standardFacts, ...this.privateFacts];
  }

  async createVault(passphrase: string): Promise<void> {
    if (this.vaultRecord) throw new VaultError('A vault already exists', 'corrupt');
    const { key, record } = await createVault(passphrase, []);
    this.vaultKey = key;
    this.vaultRecord = record;
    this.privateFacts = [];
    await this.kv.set(STORAGE_KEYS.vault, record);
  }

  async unlock(passphrase: string): Promise<void> {
    const { key, plaintext } = await unlockVault(passphrase, this.vaultRecord);
    const parsed = FactListSchema.safeParse(plaintext);
    if (!parsed.success) throw new VaultError('Vault contents are invalid', 'corrupt');
    this.vaultKey = key;
    this.privateFacts = parsed.data;
  }

  lock(): void {
    this.vaultKey = null;
    this.privateFacts = [];
  }

  async upsert(fact: MemoryFact): Promise<void> {
    if (fact.sensitivity === 'private') {
      if (!this.vaultKey || !this.vaultRecord) throw new VaultError('Unlock or create your vault to save private information', 'corrupt');
      this.privateFacts = [...this.privateFacts.filter((f) => f.key !== fact.key), fact];
      this.standardFacts = this.standardFacts.filter((f) => f.key !== fact.key);
      await this.persistVault();
      await this.persistStandard();
      return;
    }
    this.standardFacts = [...this.standardFacts.filter((f) => f.key !== fact.key), fact];
    if (this.privateFacts.some((f) => f.key === fact.key)) {
      this.privateFacts = this.privateFacts.filter((f) => f.key !== fact.key);
      await this.persistVault();
    }
    await this.persistStandard();
  }

  async remove(key: string): Promise<void> {
    const hadPrivate = this.privateFacts.some((f) => f.key === key);
    this.standardFacts = this.standardFacts.filter((f) => f.key !== key);
    this.privateFacts = this.privateFacts.filter((f) => f.key !== key);
    await this.persistStandard();
    if (hadPrivate) await this.persistVault();
  }

  async clearAll(): Promise<void> {
    this.standardFacts = [];
    this.privateFacts = [];
    this.vaultKey = null;
    this.vaultRecord = null;
    await this.kv.remove(STORAGE_KEYS.memory);
    await this.kv.remove(STORAGE_KEYS.vault);
  }

  private async persistStandard() {
    await this.kv.set(STORAGE_KEYS.memory, this.standardFacts);
  }

  private async persistVault() {
    if (!this.vaultKey || !this.vaultRecord) return;
    this.vaultRecord = await seal(this.vaultKey, this.vaultRecord.salt, this.vaultRecord.iterations, this.privateFacts);
    await this.kv.set(STORAGE_KEYS.vault, this.vaultRecord);
  }
}
