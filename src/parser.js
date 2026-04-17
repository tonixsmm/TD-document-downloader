/**
 * parser.js
 * Parses a Terradotta Questionnaire Response Report HTML export.
 *
 * Exports:
 *   parseReport(htmlText)  -> { year, programs, fieldMap, passportCodes, healthCodes }
 *
 * programs: Array<{
 *   fullName: string,       // "Gonzaga in Barcelona: Sport Management"
 *   students: Array<{
 *     displayName: string,  // raw trimmed span text
 *     last: string,
 *     first: string,
 *     docs: { [fieldCode]: string }  // fieldCode -> absolute URL
 *   }>
 * }>
 *
 * fieldMap: { [fieldCode]: { heading: string, prompt: string } }
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normSpaces(s) {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Split "Lastname Possibly Multi Word, First Middle..." into { last, first }.
 * Everything before the first comma is the last name (preserves multi-word).
 * First name is the first whitespace token after the comma.
 * Returns null if it doesn't look like a name.
 */
function parseStudentName(raw) {
  const name = normSpaces(raw);
  const commaIdx = name.indexOf(',');
  if (commaIdx === -1) return null;

  const last = name.slice(0, commaIdx).trim();
  const rest = name.slice(commaIdx + 1).trim();
  if (!last || !rest) return null;
  if (!/[A-Za-z]/.test(last)) return null;

  const first = rest.split(/\s+/)[0];
  if (!first) return null;

  return { last, first };
}

/**
 * Classify a field code as 'Passport', 'Health Form', or '' based on
 * the legend heading and prompt text.
 */
function classifyField(meta) {
  const heading = (meta.heading || '').toLowerCase();
  const prompt  = (meta.prompt  || '').toLowerCase();

  if (/passport/.test(prompt))  return 'Passport';
  if (/health\s*form|health\s*clearance|study\s*abroad\s*health/.test(prompt)) return 'Health Form';
  if (/passport/.test(heading)) return 'Passport';
  if (/health\s*form|health\s*clearance|study\s*abroad\s*health/.test(heading)) return 'Health Form';
  return '';
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * @param {string} htmlText  Full text of the Terradotta HTML export
 * @returns {{
 *   year: string,
 *   programs: Array,
 *   fieldMap: Object,
 *   passportCodes: Set<string>,
 *   healthCodes: Set<string>
 * }}
 */
function parseReport(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');

  // -------------------------------------------------------------------------
  // 1. Extract default year from the "Applications:" footer lines
  //    e.g. "Summer I, 2026  - Gonzaga in Barcelona ... Applications: 31"
  // -------------------------------------------------------------------------
  let year = '';
  {
    const yearMatch = htmlText.match(/(\d{4})\s*-\s*Gonzaga/);
    if (yearMatch) year = yearMatch[1];
  }

  // -------------------------------------------------------------------------
  // 2. Parse legend (first <table>) to build fieldMap
  // -------------------------------------------------------------------------
  const fieldMap = {};
  const keyPat = /^\d+-\d+$/;
  const tables = doc.querySelectorAll('table');
  const legendTable = tables[0];
  let currentHeading = '';

  if (legendTable) {
    for (const tr of legendTable.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('td, th')];
      if (!cells.length) continue;

      const cellTexts = cells.map(td => normSpaces(td.textContent));
      const rowText = cellTexts.filter(Boolean).join(' ').trim();
      if (!rowText) continue;
      if (rowText.toLowerCase().includes('questionnaire response report formatting key')) continue;

      if (cells.length === 1 || cells[0].getAttribute('colspan') === '2') {
        if (!keyPat.test(rowText)) currentHeading = rowText;
        continue;
      }

      const code   = cellTexts[0] || '';
      const prompt = cellTexts[1] || '';
      if (keyPat.test(code)) {
        fieldMap[code] = { heading: currentHeading, prompt };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Classify field codes
  // -------------------------------------------------------------------------
  let passportCodes = new Set(
    Object.entries(fieldMap)
      .filter(([, m]) => classifyField(m) === 'Passport')
      .map(([c]) => c)
  );
  let healthCodes = new Set(
    Object.entries(fieldMap)
      .filter(([, m]) => classifyField(m) === 'Health Form')
      .map(([c]) => c)
  );

  // Fallbacks
  const allCodes = new Set(Object.keys(fieldMap));
  if (passportCodes.size && !healthCodes.size)
    healthCodes = new Set([...allCodes].filter(c => !passportCodes.has(c)));
  if (healthCodes.size && !passportCodes.size)
    passportCodes = new Set([...allCodes].filter(c => !healthCodes.has(c)));

  // -------------------------------------------------------------------------
  // 4. Walk all H4b / H5b spans in document order to build programs + students
  // -------------------------------------------------------------------------
  const programs = [];
  let currentProgram = null;
  const seenStudents = new Set(); // "programFullName|last|first"

  const legendSpans = new Set(
    legendTable ? [...legendTable.querySelectorAll('span')] : []
  );

  const spans = doc.querySelectorAll('span.H4b, span.H5b');

  for (const span of spans) {
    const classes = [...(span.classList || [])];
    const text = normSpaces(span.textContent);
    if (!text) continue;

    // --- Program header ---
    if (classes.includes('H4b')) {
      if (legendSpans.has(span)) continue;
      currentProgram = { fullName: text, students: [] };
      programs.push(currentProgram);
      continue;
    }

    // --- Student row or Applications footer ---
    if (!classes.includes('H5b')) continue;
    if (text.includes('Applications:')) continue;
    if (!currentProgram) continue;

    const parsed = parseStudentName(text);
    if (!parsed) continue;
    const { last, first } = parsed;

    const dedupKey = `${currentProgram.fullName}|${last.toLowerCase()}|${first.toLowerCase()}`;
    if (seenStudents.has(dedupKey)) continue;
    seenStudents.add(dedupKey);

    // Walk into the detail row (next sibling <tr>) to collect doc URLs
    const tr = span.closest('tr');
    const detailTr = tr ? tr.nextElementSibling : null;
    const docs = {};

    if (detailTr) {
      const nested = detailTr.querySelector('table');
      if (nested) {
        for (const subTr of nested.querySelectorAll('tr')) {
          const tds = subTr.querySelectorAll('td');
          if (tds.length < 2) continue;
          const fieldCode = normSpaces(tds[0].textContent);
          const anchor = tds[1].querySelector('a[href]');
          if (!anchor) continue;
          // Decode HTML entities in the href
          const href = anchor.getAttribute('href') || '';
          if (href && !(fieldCode in docs)) {
            docs[fieldCode] = href; // absolute or relative; resolved at fetch time
          }
        }
      }
    }

    currentProgram.students.push({ displayName: text, last, first, docs });
  }

  return { year, programs, fieldMap, passportCodes, healthCodes };
}

// ---------------------------------------------------------------------------
// Export (works in both extension context and Node for tests)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') module.exports = { parseReport, parseStudentName, classifyField };
