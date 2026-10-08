import { rename, writeFile } from 'node:fs/promises';

/** Model an editor's atomic save so a polling watcher cannot read a truncated file. */
export async function save(path, source) {
  const temporary = path + '.next';
  await writeFile(temporary, source);
  await rename(temporary, path);
}
