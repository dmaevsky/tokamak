import test from 'ava';
import fs from 'fs/promises';
import { conclude } from 'conclure';
import { fileURLToPath } from 'url';
import resolver from '../src/resolver.js';
import { join, dirname } from 'path';
import { promisify } from 'util';

const run = promisify(conclude);

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function* isDirectory(id) {
  try {
    const stats = yield fs.stat(join(rootDir, fileURLToPath(id)));
    return stats.isDirectory();
  }
  catch {
    return false;
  }
}

function* isFile(id) {
  try {
    const stats = yield fs.stat(join(rootDir, fileURLToPath(id)));
    return stats.isFile();
  }
  catch {
    return false;
  }
}

const loader = {
  *load(url) {
    return fs.readFile(join(rootDir, fileURLToPath(url)), 'utf8');
  },

  isDirectory,
  isFile
};

const resolve = resolver({ loader });

test('Resolve an NPM module', async t => {
  const importee = "rd-parse";
  const importer = "file:///src/cjs.js";

  const resolved = await run(resolve(importee, importer));

  t.is(resolved, 'file:///node_modules/rd-parse/src/index.js');
});
