import { allSettled } from 'conclure/combinators';
import { transform } from './cjs.js';

export default ({
  resolveId,
  load,
  memoize = fn => fn,
  logger = console.debug,
}) => {

  function* loadModule(url, baseUrl, loadStack = new Map()) {
    const id = yield resolveId(url, baseUrl);

    if (!id || typeof id !== 'string') {
      throw new Error(`Failed to resolve ${url} from ${baseUrl}`);
    }

    return loadResolved(id, loadStack);
  }

  const loadResolved = memoize(function* loadResolved(id, loadStack) {
    if (loadStack.has(id)) {
      // Circular reference
      return loadStack.get(id);
    }

    try {
      const body = yield load(id);

      const node = transform(body);
      node.id = id;

      loadStack = new Map(loadStack);
      loadStack.set(id, node);

      yield allSettled(Object.keys(node.imports).concat(node.required || [])
        .map(module => loadModule(module, id, loadStack))
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

      logger('info', error, id, [...loadStack.keys()]);

      return {
        id,
        code: `throw new Error(${JSON.stringify(message)})`,
        imports: {}
      };
    }
  });

  return loadModule;
}
