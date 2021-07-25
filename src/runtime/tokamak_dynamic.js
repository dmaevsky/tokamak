import { conclude } from 'conclure';
import { all } from 'conclure/combinators';
import { fetchFile, getFetchFromJSDelivr, DELIVR_CDN } from './fetch';
import tokamak from '../tokamak.js';
import { asyncCell } from './async_cell.js';

function evalUMD(id, code) {
  const script = document.createElement('script');
  script.id = id;
  script.append(`//@ sourceURL=${id}\nwindow["${id}"] = function(module, exports, process, global, require){\n${code}\n}`);
  document.body.append(script);

  const result = window[id];
  delete window[id];
  return result;
}

function instantiateModule(node, _require, environment) {
  const instantiate = node.code;

  const module = node.code = {
    exports: {}
  };

  const process = {
    env: {
      NODE_ENV: environment
    },
    cwd: () => '.'
  };

  try {
    instantiate(module, module.exports, process, window, _require);
  }
  catch (error) {
    if (!error.requireStack) {
      error = new Error(`Error instantiating ${node.id}: ${error.message}`);
      error.requireStack = [node.id];
    }
    else error.requireStack.push(node.id);
    throw error;
  }
}

export default (options = {}) => {
  const {
    graph = {},
    logger = console.debug,
    environment
  } = options;

  const fetchFromJSDelivr = getFetchFromJSDelivr(graph, logger);

  function* fetchModule(url) {
    const fetched = yield (url.startsWith('npm://') || url.startsWith(DELIVR_CDN)
      ? fetchFromJSDelivr(url)
      : fetchFile(url, logger)
    );

    if (url === fetched.url && url.endsWith('.json')) {
      return {
        url,
        text: `module.exports = ${fetched.text}`
      };
    }
    return fetched;
  }

  const loadModule = tokamak({ fetchModule, logger }, graph);

  function requireModule(url, baseUrl) {
    if (!url && baseUrl) {
      // Resolve bundle case
      return graph[baseUrl] && requireModule(baseUrl);
    }

    const node = asyncCell(
      loadModule(url, baseUrl),
      { STALE: STALE_REQUIRE }
    );

    const { id, code, imports = {} } = node;

    if (typeof code === 'object') {
      // Module already evaluated -> return it
      return code.exports;
    }

    if (typeof code !== 'function') {
      node.code = evalUMD(id, code);
    }

    // Check static dependencies are present
    for (let dependency in imports) {
      const imported = requireModule(dependency, id);

      for (let name of Object.keys(imports[dependency] || {})) {
        if (name !== '*' && name !== 'default' && !(name in imported)) {
          throw new Error(`${name} is not exported from ${dependency} (imported from ${id})`);
        }
      }
    }

    instantiateModule(node, p => requireModule(p, id), environment);
    return node.code.exports;
  }

  requireModule.hydrate = (cb) => conclude(all(
    Object.keys(graph)
      .filter(id => !id.includes('=>'))
      .map(id => loadModule(id))
  ), cb);

  return requireModule;
}
