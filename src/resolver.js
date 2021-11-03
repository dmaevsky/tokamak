// Following https://nodejs.org/api/esm.html#esm_resolver_algorithm_specification

const defaultConditions = ['browser', 'import'];

function isValidURL(url) {
  try {
    return url === new URL(url).href;
  }
  catch {
    return false;
  }
}

export default ({ isDirectory, isFile, loadPkgJSON }) => {
  function* ESM_RESOLVE(importee, importer) {
    let resolved;

    if (isValidURL(importee)) {
      resolved = importee;
    }
    else if (/^(\/|\.\/|\.\.\/)/.test(importee)) {
      // Otherwise, if importee starts with "/", "./" or "../", then
      resolved = new URL(importee, importer).href;
    }

    if (resolved) {
      if (resolved.startsWith('file://')) {
        resolved = yield RESOLVE_AS_FILE_OR_DIRECTORY(resolved);
      }
    }
    else {
      // NPM module specifier
      if (importee[0] === '#') {
        ({ resolved } = yield PACKAGE_IMPORTS_RESOLVE(importee, importer, defaultConditions));
      }
      else {
        // Note: importee is now a bare specifier.
        resolved = yield PACKAGE_RESOLVE(importee, importer);
      }
    }

    if (resolved && (resolved.includes('%2f') || resolved.includes('%5C'))) {
      throw new Error(`Invalid Module Specifier (${importee})`);
    }
    return resolved;
  }

  function* PACKAGE_RESOLVE(packageSpecifier, parentURL) {

    const [packageName, version] = (/^((?:@[^/]+\/)?[^/@]+)(@[0-9][^/]*)?/.exec(packageSpecifier) || []).slice(1);

    if (!packageName || packageName[0] === '.' || /\\%/.test(packageName)) {
      throw new Error(`Invalid Module Specifier (${packageSpecifier})`);
    }

    if (version) {
      throw new Error(`No support for explicit version for now (${packageSpecifier})`);
    }

    const packageSubpath = '.' + packageSpecifier.slice(packageName.length);

    const selfUrl = yield PACKAGE_SELF_RESOLVE(packageName, packageSubpath, parentURL);
    if (selfUrl) return selfUrl;

    // if (packageSubpath === '.' && nodeBuiltIns.includes(packageName)) {
    //   return 'node:' + packageSpecifier;
    // }

    parentURL = new URL('./', parentURL).href;

    while (true) {
      const packageURL = new URL('node_modules/' + packageName + '/', parentURL).href;

      if (! (yield isDirectory(packageURL))) {
        if (parentURL === 'file:///') {
          throw new Error(`Module Not Found (${packageSpecifier})`);
        }
        parentURL = new URL('../', parentURL).href;
        continue;
      }

      const resolved = yield RESOLVE_FROM_PACKAGE_JSON(packageURL, packageSubpath);
      if (resolved) return resolved;

      if (packageSubpath === '.') return RESOLVE_AS_INDEX(packageURL);

      return RESOLVE_AS_FILE_OR_DIRECTORY(new URL(packageSubpath, packageURL).href);
    }
  }

  const RESOLVE_AS_FILE_OR_DIRECTORY = (url) => RESOLVE_FIRST_OF([
    RESOLVE_AS_FILE(url),
    RESOLVE_AS_DIRECTORY(url)
  ]);

  function* RESOLVE_FROM_PACKAGE_JSON(packageURL, packageSubpath) {
    const pjson = yield READ_PACKAGE_JSON(packageURL);

    if (pjson?.exports) {
      const { resolved } = yield PACKAGE_EXPORTS_RESOLVE(packageURL, packageSubpath, pjson.exports, defaultConditions);
      return resolved;
    }
    else if (packageSubpath === '.') {
      // Return the result applying the legacy LOAD_AS_DIRECTORY CommonJS resolver to packageURL
      const entrySpecifier = pjson && (pjson.browser || pjson.main);
      if (!entrySpecifier) return undefined;

      const entryPoint = new URL(entrySpecifier, packageURL).href;

      return RESOLVE_FIRST_OF([
        RESOLVE_AS_FILE(entryPoint),
        RESOLVE_AS_INDEX(entryPoint)
      ]);
    }
    return undefined;
  }

  const RESOLVE_AS_DIRECTORY = (url) => {
    if (!url.endsWith('/')) url += '/';

    return RESOLVE_FIRST_OF([
      RESOLVE_FROM_PACKAGE_JSON(url, '.'),
      RESOLVE_AS_INDEX(url)
    ]);
  }

  function *RESOLVE_EXACT(url) {
    if (yield isFile(url)) return url;
    return undefined;
  }

  function* RESOLVE_FIRST_OF(flows) {
    for (let flow of flows) {
      const resolved = yield flow;
      if (resolved) return resolved;
    }
    return undefined;
  }

  const RESOLVE_SUFFIXES = (url, suffixes) => RESOLVE_FIRST_OF(suffixes.map(suffix => RESOLVE_EXACT(url + suffix)));

  const RESOLVE_AS_FILE = url => RESOLVE_SUFFIXES(url, ['', '.js', '.json']);

  const RESOLVE_AS_INDEX = url => {
    if (!url.endsWith('/')) url += '/';
    return RESOLVE_SUFFIXES(url, ['index.js', 'index.json']);
  }


  function* PACKAGE_SELF_RESOLVE(packageName, packageSubpath, parentURL) {
    const scope = yield READ_PACKAGE_SCOPE(parentURL);
    if (!scope) return undefined;

    const { pjson, packageURL } = scope;
    if (!pjson?.exports) return undefined;

    if (pjson.name === packageName) {
      const { resolved } = yield PACKAGE_EXPORTS_RESOLVE(packageURL, packageSubpath, pjson.exports, defaultConditions);
      return resolved;
    }
    return undefined;
  }

  function *PACKAGE_EXPORTS_RESOLVE(packageURL, subpath, exports, conditions) {
    const exportsKeys = exports && typeof exports === 'object' && Object.keys(exports);

    if (exportsKeys && exportsKeys.some(key => key[0] === '.') && exportsKeys.some(key => key[0] !== '.')) {
      // If exports is an Object with both a key starting with "." and a key not starting with "."
      throw new Error(`Invalid Package Configuration (${packageURL})`);
    }

    if (subpath === '.') {
      let mainExport = undefined;

      if (typeof exports === 'string' || Array.isArray(exports) || exportsKeys && exportsKeys.every(key => key[0] !== '.')) {
        mainExport = exports;
      }
      else if (exportsKeys && '.' in exports) {
        mainExport = exports['.'];
      }

      if (mainExport !== undefined) {
        const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, mainExport, "", false, false, conditions);
        if (resolved) return { resolved };
      }
    }
    else if (exportsKeys && exportsKeys.every(key => key[0] === '.')) {
      const matchKey = subpath;
      const resolvedMatch = yield PACKAGE_IMPORTS_EXPORTS_RESOLVE(matchKey, exports, packageURL, false, conditions);

      if (resolvedMatch.resolved) return resolvedMatch;
    }

    throw new Error(`Package Path Not Exported (${subpath} in ${packageURL})`);
  }

  function* PACKAGE_IMPORTS_RESOLVE(specifier, parentURL, conditions) {
    if (specifier[0] !== '#') {
      throw new Error(`Assertion failure: specifier should start with #. Got: ${specifier}`);
    }

    if (specifier === '#' || specifier.startsWith('#/')) {
      throw new Error(`Invalid Module Specifier (${specifier})`);
    }

    const scope = yield READ_PACKAGE_SCOPE(parentURL);
    if (scope) {
      const { pjson, packageURL } = scope;

      const imports = pjson?.imports;
      if (imports && typeof imports === 'object') {
        const resolvedMatch = yield PACKAGE_IMPORTS_EXPORTS_RESOLVE(specifier, imports, packageURL, true, conditions);
        if (resolvedMatch.resolved) return resolvedMatch;
      }
    }
    throw new Error(`Package Import Not Defined (${specifier})`);
  }

  function* PACKAGE_IMPORTS_EXPORTS_RESOLVE(matchKey, matchObj, packageURL, isImports, conditions) {
    if (matchKey in matchObj && !matchKey.endsWith('*')) {
      const target = matchObj[matchKey];
      const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, target, "", false, isImports, conditions);
      return { resolved, exact: true };
    }

    // Let expansionKeys be the list of keys of matchObj ending in "/" or "*", sorted by length descending.
    const expansionKeys = Object.keys(matchObj)
      .filter(key => /[/*]$/.test(key))
      .sort((keyA, keyB) => keyB.length - keyA.length);

    for (let expansionKey of expansionKeys) {
      if (expansionKey.endsWith('*') &&
        matchKey.startsWith(expansionKey.slice(0, -1)) &&
        matchKey.length >= expansionKey.length
      ) {
        const target = matchObj[expansionKey];
        const subpath = matchKey.slice(expansionKey.length - 1);

        const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, target, subpath, true, isImports, conditions);
        return { resolved, exact: true };
      }

      if (matchKey.startsWith(expansionKey)) {
        const target = matchObj[expansionKey];
        const subpath = matchKey.slice(expansionKey.length);

        const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, target, subpath, false, isImports, conditions);
        return { resolved, exact: false };
      }
    }
    return { resolved: null, exact: true };
  }

  function* PACKAGE_TARGET_RESOLVE(packageURL, target, subpath, pattern, internal, conditions) {
    if (typeof target === 'string') {
      if (pattern === false && subpath.length && !target.endsWith('/')) {
        throw new Error(`Invalid Module Specifier ${packageURL}`);
      }

      if (!target.startsWith('./')) {
        // If internal is true and target does not start with "../" or "/" and is not a valid URL, then
        if (internal === true && !/^(\.\.\/|\/)/.test(target) && !isValidURL(target)) {
          if (pattern === true) {
            return PACKAGE_RESOLVE(target.replaceAll('*', subpath), packageURL + '/');
          }
          return PACKAGE_RESOLVE(target + subpath, packageURL + '/');
        }
        else {
          throw new Error(`Invalid Package Target (${target})`);
        }
      }

      // If target split on "/" or "\" contains any ".", ".." or "node_modules" segments after the first segment
      if (target.split(/[/\\]/).slice(1).some(part => ['.', '..', 'node_modules'].includes(part))) {
        throw new Error(`Invalid Package Target (${target})`);
      }

      const resolvedTarget = new URL(target, packageURL).href;

      if (!resolvedTarget.startsWith(packageURL)) {
        throw new Error(`Assertion failure: resolvedTarget ${resolvedTarget} is outside packageURL ${packageURL}`);
      }

      // If subpath split on "/" or "\" contains any ".", ".." or "node_modules" segments
      if (subpath.split(/[/\\]/).some(part => ['.', '..', 'node_modules'].includes(part))) {
        throw new Error(`Invalid Module Specifier`);
      }

      if (pattern === true) {
        return new URL(resolvedTarget.replaceAll('*', subpath)).href;
      }
      return new URL(subpath, resolvedTarget).href;
    }
    else if (Array.isArray(target)) {
      if (target.length === 0) return null;

      let lastError;
      for (let targetValue of target) {
        try {
          const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, targetValue, subpath, pattern, internal, conditions);
          if (!resolved) continue;
          return resolved;
        }
        catch (error) {
          lastError = error;
          continue;
        }
      }
      if (lastError) throw lastError;
      return null;
    }
    else if (target && typeof target === 'object') {
      for (let p in target) {
        if (p === 'default' || conditions.includes(p)) {
          const targetValue = target[p];

          const resolved = yield PACKAGE_TARGET_RESOLVE(packageURL, targetValue, subpath, pattern, internal, conditions);
          if (!resolved) continue;
          return resolved;
        }
      }
      return undefined;
    }
    else if (target === null) return null;

    throw new Error(`Invalid Package Target (${target})`);
  }

  function* ESM_FORMAT(url) {
    // Assert: url corresponds to an existing file.
    if (! (yield isFile(url))) {
      throw new Error(`${url} is not a file`);
    }

    if (url.endsWith('.mjs')) return 'module';
    if (url.endsWith('.cjs')) return 'commonjs';

    const scope = yield READ_PACKAGE_SCOPE(url);

    if (scope?.pjson?.type === 'module') {
      if (url.endsWith('.js')) return 'module';
    }
    throw new Error(`Unsupported File Extension (${url})`);
  }

  function* READ_PACKAGE_SCOPE(url) {
    let scopeURL = new URL('./', url).href;

    while (true) {
      if (scopeURL.endsWith('/node_modules/')) return null;

      const pjson = yield READ_PACKAGE_JSON(scopeURL);
      if (pjson !== null) {
        return { pjson, packageURL: scopeURL };
      }
      else if (scopeURL === 'file:///') {
        return null;
      }
      scopeURL = new URL('../', scopeURL).href;
    }
  }

  function* READ_PACKAGE_JSON(packageURL) {
    const pjsonURL = new URL('package.json', packageURL).href;

    const exists = yield isFile(pjsonURL);
    if (!exists) return null;

    try {
      return yield loadPkgJSON(pjsonURL);
    }
    catch (error) {
      throw new Error(`Invalid Package Configuration (${error.message})`);
    }
  }

  return ESM_RESOLVE;
}
