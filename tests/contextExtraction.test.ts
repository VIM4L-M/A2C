import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { groundedExtraction } from '@a2c/shared';
import { createApp } from '../apps/server/src/app';
import { loadConfig } from '../apps/server/src/config';

let server: Server | undefined;
afterEach(() => { server?.close(); });
const source = 'My studies are at Example University, with practical experience in Python.';
async function request(text: string, remote = false) {
  const chat = vi.fn(async () => JSON.stringify({ facts: [{ key: 'college', value: 'Example University', evidence: source }] }));
  const config = loadConfig({ GEMMA_BASE_URL: remote ? 'https://models.example.test/v1' : 'http://127.0.0.1:11434/v1', GEMMA_MODEL: 'local-test' });
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => probe.once('listening', resolve));
  config.port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  server = createApp(config, { configured: true, model: 'local-test', chat, listModels: async () => ({ reachable: true, models: [] }) }).listen(config.port, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  config.port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${config.port}/api/extract`, { method: 'POST', headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  return { response, chat };
}
describe('local-only prose extraction', () => {
  it('returns grounded candidates through the authenticated API', async () => {
    const { response, chat } = await request(source);
    expect(response.status).toBe(200);
    expect((await response.json()).facts[0].value).toBe('Example University');
    expect(chat).toHaveBeenCalledOnce();
  });
  it('rejects remote inference before sharing raw text', async () => {
    const { response, chat } = await request(source, true);
    expect(response.status).toBe(403); expect(chat).not.toHaveBeenCalled();
  });
  it('rejects credential-bearing source text before model invocation', async () => {
    const { response, chat } = await request('My password is fictional-example-only');
    expect(response.status).toBe(400); expect(chat).not.toHaveBeenCalled();
  });
  it('rejects invented evidence, values, keys, and instruction-bearing response shapes', () => {
    expect(groundedExtraction({ facts: [
      { key: 'college', value: 'Invented University', evidence: source },
      { key: 'skills', value: 'Python', evidence: 'Invented evidence Python' },
      { key: 'password', value: 'Python', evidence: source },
    ] }, source).facts).toEqual([]);
    expect(() => groundedExtraction({ facts: [], submit: true }, source)).toThrow();
  });
  it('retains valid candidates when the model returns a malformed list value', () => {
    const output = groundedExtraction({ facts: [
      { key: 'college', value: 'Example University', evidence: source },
      { key: 'skills', value: ['Python'], evidence: source },
    ] }, source);
    expect(output.facts).toHaveLength(1);
    expect(output.facts[0]?.key).toBe('college');
  });
});
