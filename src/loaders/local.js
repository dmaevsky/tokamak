import { promises as fs } from '#fs';
import { fileURLToPath } from '#url';
import memoize from './memoize_flow.js';

const isBrowser = typeof self !== 'undefined';

export default ({ cache, rootDir }) => ({
  load: memoize(function* load(url) {
    if (isBrowser) {
      throw new Error(`Cannot load ${url} in a browser`);
    }
    const body = yield fs.readFile(rootDir + fileURLToPath(url), 'utf8');

    return {
      id: url,
      code: url.endsWith('.json') ? JSON.parse(body) : body
    };

  }, [Infinity, 50], cache),

  *isDirectory(url) {
    if (!url.endsWith('/')) url += '/';

    if (Object.keys(cache).some(id => id.startsWith(url))) {
      return true;
    }

    if (isBrowser) return false;

    try {
      const stats = yield fs.stat(rootDir + fileURLToPath(url));
      return stats.isDirectory();
    }
    catch {
      return false;
    }
  },

  *isFile(url) {
    if (url in cache) return true;
    if (isBrowser) return false;

    try {
      const stats = yield fs.stat(rootDir + fileURLToPath(url));
      return stats.isFile();
    }
    catch {
      return false;
    }
  }
});
