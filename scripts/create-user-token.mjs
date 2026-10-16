// Creates a random access token for one A2C user and prints the A2C_USERS entry.
// Usage: npm run token -- <userId>
import { createHash, randomBytes } from 'node:crypto';

const userId = (process.argv[2] ?? '').toLowerCase();
if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(userId)) {
  console.error('Usage: npm run token -- <userId>   (lowercase letters, digits, - and _)');
  process.exit(1);
}
const token = `a2c_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(token, 'utf8').digest('hex');
console.log(`Token for ${userId} (give to the user, paste into A2C Settings; shown once):\n  ${token}\n`);
console.log(`Server entry (append to A2C_USERS, comma separated):\n  ${userId}:${hash}`);
