// Explicit live smoke test: fictional memory only, isolated assistant, cleanup.
import { randomUUID } from 'node:crypto';
import { createBackboardClient } from '../apps/server/src/backboardClient';

process.loadEnvFile('.env');
const apiKey = process.env.BACKBOARD_API_KEY?.trim();
if (!apiKey) throw new Error('BACKBOARD_API_KEY is missing');
const baseUrl = 'https://app.backboard.io/api';
const client = createBackboardClient({ apiKey, baseUrl, timeoutMs: 25_000 });
const user = `smoke-${randomUUID()}`;
let assistant: string | undefined;
try {
  assistant = await client.assistantFor(user);
  console.log('PASS isolated assistant');
  const saved = await client.add(user, 'Fictional A2C test student studies at Example University.', { a2c_key: 'college' });
  if (!saved.id) throw new Error('Save returned no memory id');
  console.log('PASS save');
  const listed = await client.list(user);
  if (!listed.some(m => m.id === saved.id)) throw new Error('Saved memory missing from list');
  console.log('PASS list');
  const found = await client.search(user, 'Example University', 5);
  if (!found.some(m => m.id === saved.id)) throw new Error('Saved memory missing from search');
  console.log('PASS search');
  await client.remove(user, saved.id);
  if ((await client.list(user)).some(m => m.id === saved.id)) throw new Error('Deleted memory still listed');
  console.log('PASS delete');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live smoke failed');
  process.exitCode = 1;
} finally {
  if (assistant) {
    const res = await fetch(`${baseUrl}/assistants/${encodeURIComponent(assistant)}`, {
      method: 'DELETE', headers: { 'X-API-Key': apiKey }, signal: AbortSignal.timeout(25_000),
    });
    console.log(res.ok ? 'PASS cleanup test assistant' : `FAIL cleanup HTTP ${res.status}`);
    if (!res.ok) process.exitCode = 1;
  }
}
