/**
 * converter.js
 * Detects file types from raw bytes and converts non-PDF uploads to PDF.
 *
 * Exports:
 *   detectType(bytes)             -> { ext, category }  category: 'pdf'|'image'|'word'|'html'|'unknown'
 *   convertToPdf(bytes, ext)      -> Promise<{ pdfBytes: Uint8Array, converted: boolean, note: string }>
 */

'use strict';

// Node.js compat: jsdom test environment doesn't expose TextDecoder/TextEncoder on global
if (typeof TextDecoder === 'undefined') {
  const { TextDecoder: _TD, TextEncoder: _TE } = require('util');
  global.TextDecoder = _TD;
  global.TextEncoder = _TE;
}

// ---------------------------------------------------------------------------
// Type detection (magic bytes first, then fallback)
// ---------------------------------------------------------------------------

/**
 * @param {Uint8Array} bytes
 * @returns {{ ext: string, category: string }}
 */
function detectType(bytes) {
  // PDF
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) // %PDF
    return { ext: '.pdf', category: 'pdf' };

  // HTML (login page redirect) - check for <!DOCTYPE or <html
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).toLowerCase();
  if (head.includes('<!doctype html') || head.startsWith('<html') || head.includes('<head>'))
    return { ext: '.html', category: 'html' };

  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return { ext: '.jpg', category: 'image' };

  // PNG
  if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
    return { ext: '.png', category: 'image' };

  // GIF
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { ext: '.gif', category: 'image' };

  // WebP (RIFF....WEBP)
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return { ext: '.webp', category: 'image' };

  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4D)
    return { ext: '.bmp', category: 'image' };

  // TIFF
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) ||
      (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A))
    return { ext: '.tiff', category: 'image' };

  // HEIC (ftyp box)
  if (bytes.length > 12) {
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (ftyp === 'ftyp' && (brand.startsWith('heic') || brand.startsWith('heix') || brand === 'mif1'))
      return { ext: '.heic', category: 'image' };
  }

  // DOCX / XLSX / ZIP (PK header)
  if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // Peek further for Office Open XML markers
    const peek = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2048));
    if (peek.includes('word/'))  return { ext: '.docx', category: 'word' };
    if (peek.includes('xl/'))    return { ext: '.xlsx', category: 'unknown' };
    if (peek.includes('ppt/'))   return { ext: '.pptx', category: 'unknown' };
    return { ext: '.zip', category: 'unknown' };
  }

  // Legacy OLE (old .doc / .xls / .ppt)
  if (startsWith(bytes, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
    return { ext: '.doc', category: 'word' };

  // RTF
  if (startsWith(bytes, [0x7B, 0x5C, 0x72, 0x74, 0x66])) // {\rtf
    return { ext: '.rtf', category: 'word' };

  return { ext: '.bin', category: 'unknown' };
}

function startsWith(bytes, sig) {
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// HTML response classification
// ---------------------------------------------------------------------------

/**
 * Peek inside an HTML response body to distinguish "login page" from
 * "document not found" from something else.
 * @param {Uint8Array} bytes
 * @returns {'LOGIN_PAGE' | 'NO_DOCUMENT' | 'UNKNOWN_HTML'}
 */
function classifyHtmlResponse(bytes) {
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, 4096))
    .toLowerCase();

  // SSO / login indicators
  if (
    text.includes('saml') ||
    text.includes('shibboleth') ||
    text.includes('login') ||
    text.includes('sign in') ||
    text.includes('username') ||
    text.includes('password') ||
    text.includes('gonzaga') && text.includes('authentication')
  ) return 'LOGIN_PAGE';

  // Terradotta "nothing here" indicators
  if (
    text.includes('no document') ||
    text.includes('not found') ||
    text.includes('no file') ||
    text.includes('not submitted') ||
    text.includes('not uploaded')
  ) return 'NO_DOCUMENT';

  return 'UNKNOWN_HTML';
}

// ---------------------------------------------------------------------------
// Image -> PDF conversion (canvas-based, browser only)
// ---------------------------------------------------------------------------

/**
 * Convert raw image bytes to a single-page PDF using canvas + jsPDF.
 * jsPDF must be available on window (loaded via extension).
 *
 * @param {Uint8Array} bytes
 * @param {string} ext  e.g. '.jpg'
 * @returns {Promise<Uint8Array>}
 */
async function imageToPdf(bytes, ext) {
  return new Promise((resolve, reject) => {
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png',  '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp',
    };
    const mime = mimeMap[ext] || 'image/jpeg';
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        // Fit image to letter page (8.5 x 11 inches at 72 dpi = 612 x 792 pt)
        const pageW = 612, pageH = 792;
        const margin = 36; // 0.5 inch
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const drawW = img.width  * scale;
        const drawH = img.height * scale;
        const x = margin + (maxW - drawW) / 2;
        const y = margin + (maxH - drawH) / 2;

        // eslint-disable-next-line new-cap
        const pdf = new window.jspdf.jsPDF({
          orientation: drawW > drawH ? 'landscape' : 'portrait',
          unit: 'pt',
          format: 'letter',
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL(mime);

        pdf.addImage(dataUrl, ext.replace('.', '').toUpperCase() === 'JPG' ? 'JPEG' : 'PNG',
          x, y, drawW, drawH);

        const pdfBytes = pdf.output('arraybuffer');
        resolve(new Uint8Array(pdfBytes));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image failed to load'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// DOCX -> PDF conversion (mammoth.js -> HTML -> jsPDF)
// ---------------------------------------------------------------------------

/**
 * Convert a .docx buffer to PDF.
 * Uses mammoth.js to extract HTML, then renders to PDF via jsPDF.
 * .doc (legacy binary) is not supported in-browser; saved as-is.
 *
 * @param {Uint8Array} bytes
 * @param {string} ext
 * @returns {Promise<Uint8Array>}
 */
async function wordToPdf(bytes, ext) {
  if (ext === '.doc' || ext === '.rtf') {
    throw new Error(`${ext} conversion not supported in browser (no library)`);
  }

  // mammoth needs an ArrayBuffer
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await window.mammoth.convertToHtml({ arrayBuffer: ab });
  const htmlContent = result.value;

  // Render HTML into a hidden div to measure content, then print to PDF
  // eslint-disable-next-line new-cap
  const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  await new Promise((resolve, reject) => {
    pdf.html(htmlContent, {
      callback: (doc) => { resolve(doc); },
      x: 36,
      y: 36,
      width: 540,    // 8.5in - 1in margins = 7.5in * 72 = 540pt
      windowWidth: 800,
    });
  });

  return new Uint8Array(pdf.output('arraybuffer'));
}

// ---------------------------------------------------------------------------
// Main conversion dispatcher
// ---------------------------------------------------------------------------

/**
 * @param {Uint8Array} bytes
 * @param {string} ext  from detectType()
 * @param {string} category  from detectType()
 * @returns {Promise<{
 *   pdfBytes: Uint8Array | null,
 *   status: string,
 *   note: string,
 *   originalBytes: Uint8Array,
 *   originalExt: string
 * }>}
 */
async function convertToPdf(bytes, ext, category) {
  if (category === 'pdf') {
    return { pdfBytes: bytes, status: 'DOWNLOADED_PDF', note: '', originalBytes: null, originalExt: '' };
  }

  if (category === 'html') {
    const subtype = classifyHtmlResponse(bytes);
    return { pdfBytes: null, status: subtype, note: '', originalBytes: bytes, originalExt: '.html' };
  }

  if (category === 'image') {
    try {
      const pdfBytes = await imageToPdf(bytes, ext);
      return {
        pdfBytes,
        status: `CONVERTED_FROM_${ext.replace('.', '').toUpperCase()}`,
        note: '',
        originalBytes: null,
        originalExt: '',
      };
    } catch (e) {
      return {
        pdfBytes: null,
        status: `IMAGE_CONVERSION_FAILED`,
        note: e.message,
        originalBytes: bytes,
        originalExt: ext,
      };
    }
  }

  if (category === 'word') {
    try {
      const pdfBytes = await wordToPdf(bytes, ext);
      return {
        pdfBytes,
        status: `CONVERTED_FROM_${ext.replace('.', '').toUpperCase()}`,
        note: '',
        originalBytes: null,
        originalExt: '',
      };
    } catch (e) {
      return {
        pdfBytes: null,
        status: ext === '.doc' || ext === '.rtf' ? `WORD_UNSUPPORTED_FORMAT` : `WORD_CONVERSION_FAILED`,
        note: e.message,
        originalBytes: bytes,
        originalExt: ext,
      };
    }
  }

  return { pdfBytes: null, status: 'NOT_UPLOADED', note: ext, originalBytes: bytes, originalExt: ext };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = { detectType, classifyHtmlResponse, convertToPdf, imageToPdf, wordToPdf };
}
