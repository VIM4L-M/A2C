import { describe, expect, it } from 'vitest';
import { AccountSchema, accountFacts, firstName, parseExtensionId } from '../apps/extension/src/lib/account';
import { BRIDGE_KEY, PENDING_KEY, workspaceMessage } from '../apps/extension/src/lib/workspaceBridge';
import { memoryKV } from '../apps/extension/src/lib/storage';

const url = 'http://127.0.0.1:5174/workspace/workspace.html';
const ID = 'a'.repeat(32);

describe('website account', () => {
  it('validates the account form', () => {
    expect(AccountSchema.safeParse({ name: 'Ravi Kumar', email: 'ravi@example.com', profile: 'Student' }).success).toBe(true);
    expect(AccountSchema.safeParse({ name: '', email: 'ravi@example.com' }).success).toBe(false);
    expect(AccountSchema.safeParse({ name: 'Ravi', email: 'not-an-email' }).success).toBe(false);
    expect(AccountSchema.safeParse({ name: 'Ravi', email: 'ravi@example.com', profile: 'Wizard' }).success).toBe(false);
  });

  it('reads the extension id from the address only when it is well formed', () => {
    expect(parseExtensionId(`#account?ext=${ID}`)).toBe(ID);
    expect(parseExtensionId('#account?ext=short')).toBeNull();
    expect(parseExtensionId(`#account?ext=${'Z'.repeat(32)}`)).toBeNull();
    expect(parseExtensionId('#account')).toBeNull();
  });

  it('proposes only name, email and profile type, leaving empty values out', () => {
    const facts = accountFacts({ name: 'Ravi Kumar', email: 'ravi@example.com', profile: '' });
    expect(facts.map((f) => f.key)).toEqual(['preferred_name', 'email']);
    expect(accountFacts({ name: 'Ravi', email: 'r@example.com', profile: 'Student' }).map((f) => f.key)).toEqual(['preferred_name', 'email', 'profile_type']);
    expect(firstName('  Ravi   Kumar ')).toBe('Ravi');
  });

  it('is accepted by the extension bridge as one pending batch that still needs confirmation', async () => {
    const kv = memoryKV({ [BRIDGE_KEY]: { enabled: true, shareActivity: false, keys: ['preferred_name', 'email', 'profile_type'] } });
    const facts = accountFacts({ name: 'Ravi Kumar', email: 'ravi@example.com', profile: 'Student' });
    expect(await workspaceMessage({ type: 'propose', facts }, url, kv)).toMatchObject({ ok: true, pending: 3 });
    expect(await kv.get(PENDING_KEY)).toHaveLength(3);
    // A second batch is refused until the first is confirmed or discarded.
    expect(await workspaceMessage({ type: 'propose', facts }, url, kv)).toMatchObject({ ok: false });
  });

  it('is refused when the extension has not enabled the connection or the sender is not the workspace', async () => {
    const facts = accountFacts({ name: 'Ravi Kumar', email: 'ravi@example.com', profile: '' });
    expect(await workspaceMessage({ type: 'propose', facts }, url, memoryKV())).toMatchObject({ ok: false });
    const kv = memoryKV({ [BRIDGE_KEY]: { enabled: true, shareActivity: false, keys: [] } });
    expect(await workspaceMessage({ type: 'propose', facts }, 'https://evil.example/workspace/workspace.html', kv)).toMatchObject({ ok: false });
  });
});
