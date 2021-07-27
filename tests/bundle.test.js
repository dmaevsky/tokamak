import test from "ava";
import tokamak from "../src/tokamak.js";
import { conclude } from "conclure";
import { allSettled } from "conclure/combinators";

test("integration test", async (t) => {
  let requireGraph = {};

  let fileMap = {
    "file:///file1.js": 'import test from "ava";\nexport default 42;',
  };

  const loader = {
    load: function* load(url) {
      if (!url.startsWith("file://")) {
        throw new Error(`Don't know how to load ${url}`);
      }
      // this would normally be async
      requireGraph[url] = fileMap[url];
      return {
        id: url,
        code: fileMap[url],
      };
    },
    isDirectory(url) {
      return false;
    },
    isFile(url) {
      return true;
    },
  };

  const loadModule = tokamak({
    loader,
    logger: (level, ...messages) => {
      console.log(`[${level.toUpperCase()}]`, ...messages);
    },
  });

  function* build(args) {
    const urls = args.map((arg) => `file:///${arg}`);
    yield allSettled(urls.map((url) => loadModule(url)));
  }

  await conclude(build(["file1.js"]), (err, contents) => {
    if (err) console.error(err);
    else console.log(contents);
  });

  t.deepEqual(requireGraph, {
    "file:///file1.js": `import test from "ava";\nexport default 42;`,
    "file:///package.json": undefined,
  });
});
