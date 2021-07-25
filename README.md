# tokamak
Isomorphic self-bundling bundler

## Why CJS
In Tokamak, contrrary to the current trent in JS, we made the choice to convert all modules to the CJS format (and not ESM).
There are several reasons for this choice:
- There's still a ton of NPM modules out there which are only available in CJS, while totally working in a browser
- It is much easier to isolate CJS modules for the purpose of automatic HMR

This choice comes with a couple of drawbacks:
- ESM style circular dependencies are not supported. We make an effort to support them as node style circular require, but this may break for some modules.
- All exports are by value, e.g. `export let foo = 'bar'` cannot be modified by another module that imports it. This is a more rare situation in the wild, though we saw some modules that employ this mechanism, and they will not bundle either.

## How things work
Static part produces an in-memory file-system like snapshot - the require graph
Dynamic part produces a require function that can be passed to a CJS module instantiator in the browser, and, given the require graph "file system", implements the Node CJS resolution algorithm.
... to be continued...
