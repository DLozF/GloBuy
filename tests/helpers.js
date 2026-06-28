const fs = require('fs');
const path = require('path');

function loadModule(relPath, opts = {}) {
  const {
    location = { hostname: '' },
    document = { querySelector: () => null },
    self = {},
    Node = {} // pass a real (jsdom) Node to exercise the DOM-walking paths
  } = opts;
  let code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');

  // Strip ES6 imports and exports so the code can be evaluated as a script by new Function.
  code = code.replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
  code = code.replace(/\bexport\s+(function|const|let|var|class|async\s+function)\b/g, '$1');
  code = code.replace(/\bexport\s+{[^}]*};?/g, '');

  const factory = new Function(
    'globalThis', 'self', 'location', 'document', 'Node',
    code + '\n;return globalThis;'
  );
  const g = {};
  factory(g, self, location, document, Node);
  return g;
}

module.exports = { loadModule };
