import { allSettled } from 'conclure/combinators';
import { transform } from './cjs.js';
import resolver from './resolver.js';
import memoize from './memoize_flow.js';

export default ({
  loader: fs,
  logger = console.debug,
}) => {

  const resolveId = resolver({
    loader: fs
  });

  function* loadModule(url, baseUrl, loadStack = []) {
    const id = yield resolveId(url, baseUrl);

    if (!id || typeof id !== 'string') {
      throw new Error(`Failed to resolve ${url} from ${baseUrl}`);
    }

    return loadResolved(id, loadStack);
  }

  const loadResolved = memoize(function* loadResolved(id, loadStack) {
    try {
      const node = yield fs.load(id);

      if (typeof node === 'string') {
        return loadResolved(node, loadStack);
      }

      if (loadStack.includes(id)) {
        // Circular reference
        return node;
      }

      if (!node.imports) {
        const {
          code,
          imports = {},
          required = []
        } = transform(node.code);     // node.code is either esm, umd or cjs

        Object.assign(node, { code, imports, required });
      }

      loadStack = loadStack.concat(id);

      yield allSettled(Object.keys(node.imports).concat(node.required || [])
        .map(module => loadModule(module, id, loadStack)),
      );

      return node;
    }
    catch (error) {
      const { loc, parserError: e } = error;
      const message = [
        loc && loc.file,
        e && e.loc && `${e.loc.line}:${e.loc.column}`,
        error
      ].filter(Boolean).join(' ');

      logger('info', error, id, loadStack);

      return {
        id,
        code: `throw new Error(${JSON.stringify(message)})`,
        imports: {}
      };
    }
  }, [Infinity, 1000]);

  return loadModule;
}
