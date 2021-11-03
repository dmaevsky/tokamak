import test from "ava";
import tokamak from "../src/tokamak.js";
import resolver from "../src/resolver.js";
import { conclude, whenFinished } from "conclure";

const fakeLoader = (fileMap) => ({
  load: function* load(url) {
    if (!url.startsWith("file://")) {
      throw new Error(`Don't know how to load ${url}`);
    }

    return fileMap[url];
  },
  loadPkgJSON(url) {
    throw Error("This test should not call loadPkgJSON");
  },
  isDirectory(url) {
    throw Error("This test should not call isDirectory");
  },
  isFile(url) {
    return url in fileMap;
  },
});

test.cb("basic integration test", (t) => {
  const requireGraph = {};

  const memoize = fn => (id, ...args) => {
    if (id in requireGraph) {
      return requireGraph[id];
    }

    const flow = fn(id, ...args);

    whenFinished(flow, ({ cancelled, error, result }) => {
      if (!cancelled) requireGraph[id] = error || result;
    });

    return requireGraph[id] = flow;
  }

  const fileMap = {
    "file:///file1.js": 'import test from "./ava";\nexport default 42;',
    "file:///ava.js": "export default 20;",
  };

  const { load, ...resolverParams } = fakeLoader(fileMap);

  const resolveId = resolver(resolverParams);

  const loadModule = tokamak({
    resolveId,
    load,
    memoize,
    logger: (level, ...messages) => {
      console.log(`[${level.toUpperCase()}]`, ...messages);
    },
  });

  conclude(loadModule("file:///file1.js"), (err, contents) => {
    t.deepEqual(requireGraph, {
      "file:///ava.js": {
        code: `\nexports.default = 20;`,
        id: "file:///ava.js",
        imports: {},
        required: [],
      },
      "file:///file1.js": {
        id: "file:///file1.js",
        code:
          "const __ellx_import__0 = require('./ava');\n" +
          "var test = 'default' in __ellx_import__0 ? __ellx_import__0.default : __ellx_import__0;\n" +
          "\n" +
          "exports.default = 42;",
        imports: { "./ava": { default: "test" } },
        required: [],
      },
    });
    t.end();
  });
});
