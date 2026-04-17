/**
 * config.js
 * Derives editable config tables from parsed report data.
 *
 * Exports:
 *   buildProgramRows(programs, year)  -> Array<ProgramRow>
 *   buildDocTypeRows(fieldMap, passportCodes, healthCodes) -> Array<DocTypeRow>
 *   applyNamingConvention(template, tokens) -> string
 *   slugify(s) -> string
 *
 * ProgramRow: { fullName, code, year, include }
 * DocTypeRow: { fieldCode, detectedLabel, docTypeName, folder, include }
 */

'use strict';

// ---------------------------------------------------------------------------
// Slug / sanitize
// ---------------------------------------------------------------------------

/**
 * Convert a string to a safe filename token:
 * - preserves letters, digits, hyphens
 * - collapses everything else to underscore
 * - trims leading/trailing underscores
 */
function slugify(s) {
  return s
    .replace(/['''`]/g, '')          // apostrophes: O'Brien -> OBrien
    .replace(/[^A-Za-z0-9\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// Program code pre-fill heuristic
// ---------------------------------------------------------------------------

// Words to strip when guessing a short code from the full program name
const STRIP_WORDS = new Set([
  'gonzaga', 'in', 'on', 'the', 'a', 'an', 'of', 'and', '&',
  'study', 'abroad', 'program',
]);

/**
 * Guess a short code from a full program name.
 * "Gonzaga in Barcelona: Sport Management" -> "Barcelona"
 * "Gonzaga on the Camino: Space, Movement, and Leadership" -> "Camino"
 * "Gonzaga in Zambezi" -> "Zambezi"
 *
 * Strategy: take the first "meaningful" word after stripping common words,
 * which is typically the location name.
 */
function guessCode(fullName) {
  // Strip everything after a colon (sub-title)
  const base = fullName.split(':')[0];
  const words = base.split(/[\s,]+/).filter(Boolean);
  for (const word of words) {
    if (!STRIP_WORDS.has(word.toLowerCase()) && word.length > 1) {
      // Capitalize first letter only
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
  }
  // Fallback: slugify the whole name
  return slugify(fullName).slice(0, 20);
}

// ---------------------------------------------------------------------------
// buildProgramRows
// ---------------------------------------------------------------------------

/**
 * @param {Array<{fullName: string}>} programs
 * @param {string} defaultYear  extracted from report (e.g. "2026")
 * @returns {Array<{fullName, code, year, include}>}
 */
function buildProgramRows(programs, defaultYear) {
  return programs.map(p => ({
    fullName: p.fullName,
    code: guessCode(p.fullName),
    year: defaultYear || new Date().getFullYear().toString(),
    include: true,
  }));
}

// ---------------------------------------------------------------------------
// buildDocTypeRows
// ---------------------------------------------------------------------------

/**
 * @param {Object} fieldMap   { [code]: { heading, prompt } }
 * @param {Set<string>} passportCodes
 * @param {Set<string>} healthCodes
 * @returns {Array<{fieldCode, detectedLabel, docTypeName, folder, include}>}
 */
function buildDocTypeRows(fieldMap, passportCodes, healthCodes) {
  return Object.entries(fieldMap).map(([fieldCode, meta]) => {
    let docTypeName = '';
    if (passportCodes.has(fieldCode))   docTypeName = 'Passport';
    else if (healthCodes.has(fieldCode)) docTypeName = 'Health Form';
    else docTypeName = slugify(meta.heading || meta.prompt || fieldCode);

    const detectedLabel = [meta.heading, meta.prompt]
      .filter(Boolean)
      .join(' / ')
      .slice(0, 80);

    return {
      fieldCode,
      detectedLabel,
      docTypeName,
      folder: docTypeName,   // folder mirrors docTypeName by default; user can override
      include: true,
    };
  });
}

// ---------------------------------------------------------------------------
// applyNamingConvention
// ---------------------------------------------------------------------------

const VALID_TOKENS = new Set(['{DOC_TYPE}', '{LAST}', '{FIRST}', '{CODE}', '{YEAR}']);

/**
 * Replace tokens in a naming template.
 * @param {string} template  e.g. "{DOC_TYPE}_{LAST}_{FIRST}_{CODE}{YEAR}"
 * @param {{ DOC_TYPE, LAST, FIRST, CODE, YEAR }} tokens
 * @returns {string}  filename without extension (caller appends .pdf)
 */
function applyNamingConvention(template, tokens) {
  return template
    .replace(/\{DOC_TYPE\}/g, slugify(tokens.DOC_TYPE || ''))
    .replace(/\{LAST\}/g,     slugify(tokens.LAST     || ''))
    .replace(/\{FIRST\}/g,    slugify(tokens.FIRST    || ''))
    .replace(/\{CODE\}/g,     slugify(tokens.CODE     || ''))
    .replace(/\{YEAR\}/g,     (tokens.YEAR            || '').replace(/\D/g, ''));
}

/**
 * Validate that a template string contains at least one known token
 * and no unrecognised {XYZ} tokens.
 * Returns null if valid, or an error string.
 */
function validateTemplate(template) {
  const found = template.match(/\{[^}]+\}/g) || [];
  const unknown = found.filter(t => !VALID_TOKENS.has(t));
  if (unknown.length) return `Unknown token(s): ${unknown.join(', ')}`;
  if (!found.length)  return 'Template must contain at least one token like {LAST}';
  return null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = {
    slugify,
    guessCode,
    buildProgramRows,
    buildDocTypeRows,
    applyNamingConvention,
    validateTemplate,
  };
}
