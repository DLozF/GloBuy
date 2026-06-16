// Glossary registry + exact-match lookup. Luxury/resale condition and authenticity
// labels are short, standalone strings that machine translation often renders
// inconsistently, so we override them with curated translations and let MT handle
// everything else.

import fr from './fr.js';
import it from './it.js';
import de from './de.js';
import es from './es.js';
import ja from './ja.js';

const TABLES = { fr, it, de, es, ja };

// Combining diacritical marks (U+0300–U+036F), stripped after NFD decomposition.
const DIACRITICS = /[̀-ͯ]/g;

/** Normalize a string for glossary matching: lowercase, collapse whitespace, strip accents. */
export function normalizeTerm(text) {
  return text
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return a curated English translation for an exact (whole-node) glossary match,
 * or null when no override applies.
 */
export function applyGlossary(text, sourceLang) {
  const table = TABLES[sourceLang];
  if (!table) return null;
  const key = normalizeTerm(text);
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

export function hasGlossary(sourceLang) {
  return Boolean(TABLES[sourceLang]);
}
