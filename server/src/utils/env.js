import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../.env');

// Updates (or appends) key=value pairs in the .env file without touching other lines.
export function updateEnvFile(updates) {
  let content = '';
  try { content = readFileSync(ENV_PATH, 'utf8'); } catch { /* file missing */ }

  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content = content.trimEnd() + '\n' + line + '\n';
    }
  }

  writeFileSync(ENV_PATH, content, 'utf8');
}
