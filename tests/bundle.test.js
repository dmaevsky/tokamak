import test from "ava";
import tokamak from "../src/tokamak.js";
import { conclude } from "conclure";

const fakeLoader = (fileMap, requireGraph) => ({
  load: function* load(url) {
    if (!url.startsWith("file://")) {
      throw new Error(`Don't know how to load ${url}`);
    }

    requireGraph[url] = {
      id: url,
      code: fileMap[url], // this gets transpiled later
    };

    return requireGraph[url];
  },
  isDirectory(url) {
    throw Error("This test should not call isDirectory");
  },
  isFile(url) {
    return Object.keys(fileMap).includes(url);
  },
});

test.cb("basic integration test", (t) => {
  let requireGraph = {};

  const fileMap = {
    "file:///file1.js": 'import test from "./ava";\nexport default 42;',
    "file:///ava.js": "export default 20;",
  };

  const loadModule = tokamak({
    loader: fakeLoader(fileMap, requireGraph),
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
