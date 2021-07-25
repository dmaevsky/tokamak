import { allSettled } from 'conclure/combinators';
import { transform } from './cjs.js';
import resolver from './resolver.js';

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

    try {
      const node = yield fs.load(id);

      if (typeof node === 'string') {
        return loadModule(node, null, loadStack);
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
      else if (node.src && node.code === undefined) {
        const { code } = yield fs.load(node.src);
        node.code = code;
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

      logger('info', error, url, baseUrl, loadStack);

      return {
        id,
        code: `throw new Error(${JSON.stringify(message)})`,
        imports: {}
      };
    }
  }

  return loadModule;
}
