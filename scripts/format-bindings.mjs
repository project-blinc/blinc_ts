import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

for (const name of ['gpu', 'window', 'layout', 'scene']) {
  const path = fileURLToPath(new URL('../src/native/generated/' + name + '.ts', import.meta.url));
  const source = await readFile(path, 'utf8');
  const formatted = await format(source, { ...(await resolveConfig(path)), filepath: path });
  if (source !== formatted) {
    await writeFile(path, formatted);
  }
}
