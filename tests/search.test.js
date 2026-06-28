const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers');

// search.js calls document.addEventListener only inside install(); loading the
// module just defines the heuristic, so a stub document is enough.
const should = loadModule('src/content/search.js').GlobuySearch.shouldTranslateQuery;

test('translates an all-Latin query', () => {
  assert.equal(should('leather bag'), true);
  assert.equal(should('GUCCI marmont'), true);
});

test('skips a query already containing the site language (mixed)', () => {
  assert.equal(should('GUCCI 가방'), false);
  assert.equal(should('가방'), false);
  assert.equal(should('バッグ'), false);
  assert.equal(should('手提包'), false);
});

test('skips queries with no Latin letters (numbers/symbols only)', () => {
  assert.equal(should('12345'), false);
  assert.equal(should('   '), false);
});
