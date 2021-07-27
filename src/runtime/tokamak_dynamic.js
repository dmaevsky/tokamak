import { conclude } from 'conclure';
import tokamak from '../tokamak.js';

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

  // Save an empty module in node (in order to support circular require)
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
    loader,
    onStale,
    logger = console.debug,
    environment
  } = options;

  const loadModule = tokamak({
    loader,
    logger,
  });

  function requireModule(url, baseUrl) {
    const loadFlow = loadModule(url, baseUrl);

    let r = null;
    const cancel = conclude(loadFlow, (error, result) => r = { error, result });

    if (!r) {
      // loadFlow did not conclude synchronously
      return onStale(url, baseUrl, loadFlow, cancel);
    }

    if (r.error) throw r.error;

    const node = r.result;
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

  return requireModule;
}
