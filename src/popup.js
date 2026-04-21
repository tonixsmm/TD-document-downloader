/**
 * popup.js
 * Controller for the three-step extension popup.
 * Depends on: parser.js, config.js, converter.js, downloader.js (all loaded before this)
 */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  htmlText:       null,
  filename:       '',
  parsed:         null,    // { year, programs, fieldMap, passportCodes, healthCodes }
  programRows:    [],      // Array<ProgramRow>
  docTypeRows:    [],      // Array<DocTypeRow>
  template:       '{DOC_TYPE}_{LAST}_{FIRST}_{CODE}{YEAR}',
  zipBlob:        null,
  manifest:       null,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

const dropZone      = $('dropZone');
const fileInput     = $('fileInput');
const fileLoaded    = $('fileLoaded');
const loadedFilename= $('loadedFilename');
const reparseBtn    = $('reparseBtn');
const parseError    = $('parseError');
const toStep2Btn    = $('toStep2Btn');

const backTo1Btn    = $('backTo1Btn');
const toStep3Btn    = $('toStep3Btn');
const templateInput = $('templateInput');
const templateError = $('templateError');
const templatePreview = $('templatePreview');
const programTbody  = $('programTbody');
const docTypeTbody  = $('docTypeTbody');

const backTo2Btn    = $('backTo2Btn');
const progressLabel = $('progressLabel');
const progressCount = $('progressCount');
const progressBar   = $('progressBar');
const progressLog   = $('progressLog');
const summaryGrid   = $('summaryGrid');
const sumOk         = $('sumOk');
const sumWarn       = $('sumWarn');
const sumErr        = $('sumErr');
const downloadZipBtn= $('downloadZipBtn');

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------
function goToStep(n) {
  for (let i = 1; i <= 3; i++) {
    $(`panel-${i}`).classList.toggle('active', i === n);
    const tab = $(`tab-${i}`);
    tab.classList.toggle('active', i === n);
    tab.classList.toggle('done', i < n);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Upload
// ---------------------------------------------------------------------------
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

reparseBtn.addEventListener('click', () => {
  fileLoaded.style.display = 'none';
  dropZone.style.display = '';
  toStep2Btn.disabled = true;
  state.htmlText = null;
  fileInput.value = '';
});

function loadFile(file) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) {
    showError(parseError, 'Please select a .html or .htm file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const html = e.target.result;
      const parsed = parseReport(html);
      if (!parsed.programs.length) {
        showError(parseError, 'No programs found in this file. Make sure it is a Terradotta Questionnaire Response Report.');
        return;
      }
      state.htmlText = html;
      state.filename = file.name;
      state.parsed   = parsed;
      hideError(parseError);
      loadedFilename.textContent = `${file.name} · ${parsed.programs.length} programs · ${countStudents(parsed)} students`;
      fileLoaded.style.display = 'flex';
      dropZone.style.display = 'none';
      toStep2Btn.disabled = false;
    } catch (err) {
      showError(parseError, `Parse error: ${err.message}`);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function countStudents(parsed) {
  return parsed.programs.reduce((n, p) => n + p.students.length, 0);
}

toStep2Btn.addEventListener('click', () => {
  buildConfigTables();
  goToStep(2);
});

// ---------------------------------------------------------------------------
// Step 2 — Configure
// ---------------------------------------------------------------------------
backTo1Btn.addEventListener('click', () => goToStep(1));

function buildConfigTables() {
  const { programs, fieldMap, passportCodes, healthCodes, year } = state.parsed;

  state.programRows  = buildProgramRows(programs, year);
  state.docTypeRows  = buildDocTypeRows(fieldMap, passportCodes, healthCodes);
  state.template     = templateInput.value.trim();

  renderProgramTable();
  renderDocTypeTable();
  updateTemplatePreview();
}

// -- Program table --
function renderProgramTable() {
  programTbody.innerHTML = '';
  state.programRows.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (!row.include) tr.classList.add('excluded');
    tr.innerHTML = `
      <td><input type="checkbox" class="cfg-check" data-prog="${i}" ${row.include ? 'checked' : ''}></td>
      <td style="font-size:11px">${escHtml(row.fullName)}</td>
      <td><input class="cfg-input" data-prog-code="${i}" value="${escHtml(row.code)}" maxlength="40" spellcheck="false"></td>
      <td><input class="cfg-input" data-prog-year="${i}" value="${escHtml(row.year)}" maxlength="4" spellcheck="false" style="width:52px"></td>
    `;
    programTbody.appendChild(tr);
  });

  // Checkbox toggles
  programTbody.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      const i = +e.target.dataset.prog;
      state.programRows[i].include = e.target.checked;
      e.target.closest('tr').classList.toggle('excluded', !e.target.checked);
    });
  });
  // Code edits
  programTbody.querySelectorAll('input[data-prog-code]').forEach(inp => {
    inp.addEventListener('input', e => {
      state.programRows[+e.target.dataset.progCode].code = e.target.value;
      updateTemplatePreview();
    });
  });
  // Year edits
  programTbody.querySelectorAll('input[data-prog-year]').forEach(inp => {
    inp.addEventListener('input', e => {
      state.programRows[+e.target.dataset.progYear].year = e.target.value;
      updateTemplatePreview();
    });
  });
}

// -- Doc type table --
function renderDocTypeTable() {
  docTypeTbody.innerHTML = '';
  state.docTypeRows.forEach((row, i) => {
    if (row.convertToPdf === undefined) row.convertToPdf = true;
    const tr = document.createElement('tr');
    if (!row.include) tr.classList.add('excluded');
    tr.innerHTML = `
      <td><input type="checkbox" class="cfg-check" data-dt="${i}" ${row.include ? 'checked' : ''}></td>
      <td><span class="field-code-badge">${escHtml(row.fieldCode)}</span></td>
      <td class="detected-label">${escHtml(row.detectedLabel)}</td>
      <td><input class="cfg-input" data-dt-name="${i}" value="${escHtml(row.docTypeName)}" maxlength="60" spellcheck="false"></td>
      <td style="text-align:center"><input type="checkbox" class="cfg-check" data-dt-pdf="${i}" ${row.convertToPdf ? 'checked' : ''}></td>
    `;
    docTypeTbody.appendChild(tr);
  });

  docTypeTbody.querySelectorAll('input[data-dt]').forEach(cb => {
    cb.addEventListener('change', e => {
      const i = +e.target.dataset.dt;
      state.docTypeRows[i].include = e.target.checked;
      e.target.closest('tr').classList.toggle('excluded', !e.target.checked);
    });
  });
  docTypeTbody.querySelectorAll('input[data-dt-pdf]').forEach(cb => {
    cb.addEventListener('change', e => {
      state.docTypeRows[+e.target.dataset.dtPdf].convertToPdf = e.target.checked;
    });
  });
  docTypeTbody.querySelectorAll('input[data-dt-name]').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = +e.target.dataset.dtName;
      state.docTypeRows[i].docTypeName = e.target.value;
      state.docTypeRows[i].folder = e.target.value;
      updateTemplatePreview();
    });
  });
}

// -- Naming convention --
templateInput.addEventListener('input', () => {
  state.template = templateInput.value.trim();
  updateTemplatePreview();
});

function updateTemplatePreview() {
  const err = validateTemplate(state.template);
  if (err) {
    templateError.textContent = err;
    templatePreview.textContent = '';
    toStep3Btn.disabled = true;
    return;
  }
  templateError.textContent = '';
  toStep3Btn.disabled = false;
  const firstDocType = (state.docTypeRows.find(d => d.include) || {}).docTypeName || 'Passport';
  const firstProg    = (state.programRows.find(p => p.include)) || { code: 'Barcelona', year: '2026' };
  const sample = applyNamingConvention(state.template, {
    DOC_TYPE: firstDocType,
    LAST:     'SMITH',
    FIRST:    'Jane',
    CODE:     firstProg.code || 'Code',
    YEAR:     firstProg.year || '2026',
  });
  templatePreview.textContent = `Preview: ${sample}.pdf`;
}

toStep3Btn.addEventListener('click', () => {
  const included = state.programRows.filter(p => p.include);
  if (!included.length) {
    alert('Please include at least one program.');
    return;
  }
  goToStep(3);
  startDownload();
});

// ---------------------------------------------------------------------------
// Step 3 — Download
// ---------------------------------------------------------------------------
backTo2Btn.addEventListener('click', () => goToStep(2));

let _zipBlob = null;

async function startDownload() {
  progressLog.innerHTML = '';
  summaryGrid.style.display = 'none';
  downloadZipBtn.classList.remove('visible');
  backTo2Btn.disabled = true;

  let okCount = 0, warnCount = 0, errCount = 0;

  const config = {
    programs:       state.programRows,
    docTypeRows:    state.docTypeRows,
    template:       state.template,
    parsedPrograms: state.parsed.programs,
  };

  try {
    const { zipBlob, manifest } = await runDownload(config, ({ label, status, done, total }) => {
      // Progress bar
      const pct = total ? Math.round((done / total) * 100) : 0;
      progressBar.style.width = `${pct}%`;
      progressCount.textContent = `${done} / ${total}`;
      progressLabel.textContent = done === total ? 'Complete' : 'Downloading…';

      // Log line
      const div = document.createElement('div');
      const ok = status.startsWith('DOWNLOADED') || status.startsWith('CONVERTED');
      const isErr = status === 'ERROR' || status.startsWith('IMAGE_CONV') || status.startsWith('WORD_CONV');
      const isFetching = status === 'fetching';

      div.className = isFetching ? 'log-fetching' : ok ? 'log-ok' : isErr ? 'log-err' : 'log-warn';
      div.textContent = isFetching
        ? `  → ${label}`
        : `  ${ok ? '✓' : isErr ? '✗' : '⚠'} ${label}: ${status}`;
      progressLog.appendChild(div);
      progressLog.scrollTop = progressLog.scrollHeight;

      // Tally (only on non-fetching updates)
      if (!isFetching) {
        if (ok) okCount++;
        else if (isErr) errCount++;
        else warnCount++;
      }
    });

    _zipBlob = zipBlob;
    state.manifest = manifest;

    // Show summary
    sumOk.textContent   = okCount;
    sumWarn.textContent = warnCount;
    sumErr.textContent  = errCount;
    summaryGrid.style.display = 'grid';
    downloadZipBtn.classList.add('visible');
    progressLabel.textContent = 'Done';

    const finalLine = document.createElement('div');
    finalLine.className = 'log-info';
    finalLine.textContent = `\n  Manifest included in ZIP as download_manifest.csv`;
    progressLog.appendChild(finalLine);

  } catch (err) {
    const div = document.createElement('div');
    div.className = 'log-err';
    div.textContent = `Fatal error: ${err.message}`;
    progressLog.appendChild(div);
    progressLabel.textContent = 'Failed';
  }

  backTo2Btn.disabled = false;
}

downloadZipBtn.addEventListener('click', () => {
  if (!_zipBlob) return;
  const url = URL.createObjectURL(_zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TerradottaDocs_${new Date().toISOString().slice(0,10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function showError(el, msg) { el.textContent = msg; el.classList.add('visible'); }
function hideError(el) { el.textContent = ''; el.classList.remove('visible'); }
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initialize preview
updateTemplatePreview();
