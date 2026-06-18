// Load a content-script module (which assigns its API onto globalThis) in
// isolation, injecting stub browser globals. The modules are plain IIFEs with no
// build step, so we eval the source with the globals they reference as params.
const fs = require('fs');
const path = require('path');

function loadModule(relPath, opts = {}) {
  const {
    location = { hostname: '' },
    document = { querySelector: () => null },
    self = {}
  } = opts;
  const code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const factory = new Function(
    'globalThis', 'self', 'location', 'document', 'Node',
    code + '\n;return globalThis;'
  );
  const g = {};
  factory(g, self, location, document, {});
  return g;
}

module.exports = { loadModule };
