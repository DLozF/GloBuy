import { describe, it, expect } from 'vitest';
import { normalizeTerm, applyGlossary } from '../src/content/glossary/index.js';

describe('normalizeTerm', () => {
  it('lowercases, trims, and strips accents', () => {
    expect(normalizeTerm('  Neuf Avec Étiquette ')).toBe('neuf avec etiquette');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeTerm('très   bon  état')).toBe('tres bon etat');
  });
});

describe('applyGlossary', () => {
  it('returns curated translations for known terms', () => {
    expect(applyGlossary('Neuf avec étiquette', 'fr')).toBe('new with tags');
    expect(applyGlossary('Mai indossato', 'it')).toBe('never worn');
  });

  it('returns null for unknown terms', () => {
    expect(applyGlossary('bonjour le monde', 'fr')).toBe(null);
  });

  it('returns null for languages without a table', () => {
    expect(applyGlossary('whatever', 'xx')).toBe(null);
  });
});
