import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { isConfigured, isLoopback, loadConfig } from './config';
import { createGemmaClient } from './gemmaClient';

// Load the repository-root .env if present (Node >= 20.12).
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config = loadConfig();
const client = createGemmaClient(config);
const app = createApp(config, client);

if (!isLoopback(config.host)) {
  console.warn(`WARNING: HOST=${config.host} exposes this unauthenticated proxy beyond localhost.`);
}

app.listen(config.port, config.host, () => {
  console.log(`A2C Gemma proxy listening on http://${config.host}:${config.port}`);
  if (isConfigured(config)) {
    console.log(`Gemma model: ${config.gemmaModel} via ${new URL(config.gemmaBaseUrl!).host}`);
  } else {
    console.warn('Gemma is NOT configured (set GEMMA_BASE_URL and GEMMA_MODEL). /api/map will return 503; the extension will show a setup warning.');
  }
  if (config.allowedOrigins.length === 0) {
    console.warn('ALLOWED_ORIGINS is empty: accepting any chrome-extension:// origin (development mode). Set it to your extension origin.');
  }
});
