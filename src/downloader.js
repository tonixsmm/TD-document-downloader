/**
 * downloader.js
 * Orchestrates fetching, conversion, and ZIP assembly.
 *
 * Exports:
 *   runDownload(config, progressCallback) -> Promise<{ zipBlob, manifest }>
 *
 * config: {
 *   programs:     Array<ProgramRow>   (from config.js, only included ones)
 *   docTypeRows:  Array<DocTypeRow>   (from config.js, only included ones)
 *   template:     string              (naming convention template)
 *   parsedPrograms: Array             (from parser.js)
 *   reportBaseUrl:  string            (for resolving relative hrefs, optional)
 * }
 *
 * progressCallback({ program, student, docType, status, total, done })
 */

'use strict';

// In Node test context, load via require(). In the browser extension the
// functions are already globals exposed by the preceding <script> tags.
if (typeof require === 'function') {
  var applyNamingConvention = require('./config').applyNamingConvention;  // eslint-disable-line no-var
  var detectType   = require('./converter').detectType;                    // eslint-disable-line no-var
  var convertToPdf = require('./converter').convertToPdf;                  // eslint-disable-line no-var
}

// ---------------------------------------------------------------------------
// Library preflight check
// ---------------------------------------------------------------------------

function assertLibrariesLoaded() {
  const missing = [];
  if (typeof window.JSZip !== 'function')
    missing.push('JSZip');
  if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function')
    missing.push('jsPDF');
  if (!window.mammoth || typeof window.mammoth.convertToHtml !== 'function')
    missing.push('mammoth');
  if (missing.length > 0) {
    throw new Error(
      `Required libraries failed to initialize: ${missing.join(', ')}. ` +
      `This is typically caused by antivirus or endpoint-security software on managed Windows machines. ` +
      `Try disabling your security software temporarily or contact your IT department.`
    );
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL using the browser's authenticated session.
 * Sets Referer and Origin to look like a legitimate Terradotta navigation.
 *
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
const TERRADOTTA_BASE = 'https://studyabroad.gonzaga.edu/';

function resolveUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return TERRADOTTA_BASE + (url.startsWith('/') ? url.slice(1) : url);
}

async function fetchAuthenticated(url) {
  const resp = await fetch(resolveUrl(url), {
    method: 'GET',
    credentials: 'include',   // send Gonzaga session cookies
    headers: {
      'Referer': 'https://studyabroad.gonzaga.edu/',
      'Origin':  'https://studyabroad.gonzaga.edu',
    },
  });
  if (!resp.ok && resp.status !== 200) {
    // Still read the body — it might be an HTML error page we want to classify
  }
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

// ---------------------------------------------------------------------------
// Build the work queue
// ---------------------------------------------------------------------------

/**
 * Returns a flat array of work items from the config.
 * Each item: { programCode, programYear, student, docTypeName, folder, fieldCode, url }
 */
function buildQueue(config) {
  const { programs, docTypeRows, template, parsedPrograms } = config;

  // Build fast lookups
  const programByFullName = new Map(
    programs.map(p => [p.fullName, p])
  );
  const docTypeByCode = new Map(
    docTypeRows.map(d => [d.fieldCode, d])
  );

  const queue = [];

  for (const parsed of parsedPrograms) {
    const programRow = programByFullName.get(parsed.fullName);
    if (!programRow || !programRow.include) continue;

    for (const student of parsed.students) {
      for (const [fieldCode, url] of Object.entries(student.docs)) {
        const docTypeRow = docTypeByCode.get(fieldCode);
        if (!docTypeRow || !docTypeRow.include) continue;
        if (!url) continue;

        queue.push({
          programCode:   programRow.code,
          programYear:   programRow.year,
          programFull:   parsed.fullName,
          student,
          docTypeName:   docTypeRow.docTypeName,
          folder:        docTypeRow.folder || docTypeRow.docTypeName,
          fieldCode,
          url,
          convertToPdf:  docTypeRow.convertToPdf !== false,
        });
      }
    }
  }

  return queue;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * @param {object} config
 * @param {function} onProgress
 * @returns {Promise<{ zipBlob: Blob, manifest: Array }>}
 */
async function runDownload(config, onProgress) {
  assertLibrariesLoaded();
  const { template } = config;
  const queue = buildQueue(config);
  const total = queue.length;

  // JSZip must be loaded as a global
  const zip = new window.JSZip();
  const manifest = [];
  let done = 0;

  for (const item of queue) {
    const { programCode, programYear, programFull, student, docTypeName, folder, url } = item;
    const label = `[${programCode}] ${student.displayName} / ${docTypeName}`;

    onProgress({ label, status: 'fetching', done, total });

    const manifestRow = {
      program_code:  programCode,
      program_full:  programFull,
      program_year:  programYear,
      display_name:  student.displayName,
      last:          student.last,
      first:         student.first,
      doc_type:      docTypeName,
      url,
      output_path:   '',
      status:        '',
      note:          '',
    };

    try {
      // 1. Fetch
      const bytes = await fetchAuthenticated(url);

      // 2. Detect
      const { ext, category } = detectType(bytes);

      // 3. Convert (or keep original if user disabled PDF conversion for this doc type)
      let result;
      if (!item.convertToPdf && category !== 'pdf' && category !== 'html') {
        result = { pdfBytes: null, status: 'DOWNLOADED_ORIGINAL', note: '', originalBytes: bytes, originalExt: ext };
      } else {
        result = await convertToPdf(bytes, ext, category);
      }

      // 4. Build filename
      const filename = applyNamingConvention(template, {
        DOC_TYPE: docTypeName,
        LAST:     student.last,
        FIRST:    student.first,
        CODE:     programCode,
        YEAR:     programYear,
      });

      if (result.pdfBytes) {
        const zipPath = `${programCode}/${folder}/${filename}.pdf`;
        zip.file(zipPath, result.pdfBytes);
        manifestRow.output_path = zipPath;
        manifestRow.status = result.status;
        onProgress({ label, status: result.status, done: ++done, total });
      } else {
        if (result.originalBytes && result.status !== 'NOT_UPLOADED') {
          const suffix = result.status === 'DOWNLOADED_ORIGINAL' ? '' : '_NEEDS_REVIEW';
          const rawExt = result.originalExt || '.bin';
          const rawPath = `${programCode}/${folder}/${filename}${suffix}${rawExt}`;
          zip.file(rawPath, result.originalBytes);
          manifestRow.output_path = rawPath;
        }
        manifestRow.status = result.status;
        manifestRow.note   = result.note || '';
        onProgress({ label, status: result.status, done: ++done, total });
      }
    } catch (e) {
      manifestRow.status = `ERROR`;
      manifestRow.note   = e.message;
      onProgress({ label, status: 'ERROR', done: ++done, total });
    }

    manifest.push(manifestRow);
  }

  // Add manifest CSV to the zip
  const csvLines = [
    'program_code,program_full,program_year,display_name,last,first,doc_type,url,output_path,status,note',
    ...manifest.map(r =>
      [
        r.program_code, r.program_full, r.program_year,
        r.display_name, r.last, r.first,
        r.doc_type, r.url, r.output_path, r.status, r.note,
      ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  zip.file('download_manifest.csv', csvLines.join('\r\n'));

  // Generate ZIP blob
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { zipBlob, manifest };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = { runDownload, buildQueue, fetchAuthenticated };
}
