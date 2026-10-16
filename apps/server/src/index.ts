import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { configProblems, isConfigured, isLoopback, loadConfig } from './config';
import { createGemmaClient } from './gemmaClient';

// Load the repository-root .env if present (Node >= 20.12). Render injects env vars directly.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config = loadConfig();
const problems = configProblems(config);
if (problems.length > 0) {
  console.error('Refusing to start an unsafe public server:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const app = createApp(config, createGemmaClient(config));

app.listen(config.port, config.host, () => {
  console.log(`A2C backend listening on http://${config.host}:${config.port} (${config.production ? 'production' : 'development'})`);
  console.log(config.users.length > 0 ? `Auth: ${config.users.length} user(s) configured` : 'Auth: local single-user mode (loopback only)');
  if (isConfigured(config)) console.log(`Gemma model: ${config.gemmaModel} via ${new URL(config.gemmaBaseUrl!).host}`);
  else console.warn('Gemma is NOT configured (set GEMMA_BASE_URL and GEMMA_MODEL). /api/map will return 503; the extension shows a setup warning.');
  console.log(`Backboard cloud memory: ${config.backboardApiKey ? 'configured' : 'not configured (local memory only)'}`);
  console.log(`Fine-tuned specialist: ${config.specialistBaseUrl && config.specialistModel ? config.specialistModel : 'not configured'}`);
  if (isLoopback(config.host) && config.allowedOrigins.length === 0) {
    console.warn('ALLOWED_EXTENSION_ORIGIN is empty: accepting any chrome-extension:// origin (local development only).');
  }
});
