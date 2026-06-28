import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerm, applyGlossary } from '../src/content/glossary/index.js';

describe('normalizeTerm', () => {
  it('lowercases, trims, and strips accents', () => {
    assert.equal(normalizeTerm('  Neuf Avec Étiquette '), 'neuf avec etiquette');
  });

  it('collapses internal whitespace', () => {
    assert.equal(normalizeTerm('très   bon  état'), 'tres bon etat');
  });
});

describe('applyGlossary', () => {
  it('returns curated translations for known terms', () => {
    assert.equal(applyGlossary('Neuf avec étiquette', 'fr'), 'new with tags');
    assert.equal(applyGlossary('Mai indossato', 'it'), 'never worn');
  });

  it('returns null for unknown terms', () => {
    assert.equal(applyGlossary('bonjour le monde', 'fr'), null);
  });

  it('returns null for languages without a table', () => {
    assert.equal(applyGlossary('whatever', 'xx'), null);
  });
});
