# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Extension (Manifest V3) for Gonzaga University's study abroad office. Staff upload a Terradotta Questionnaire Response Report HTML export, configure naming/filtering options, and the extension fetches passport and health form documents from `studyabroad.gonzaga.edu` using the browser's authenticated session, converts them to PDF, and packages them into a ZIP.

## Loading the extension

There is no build step. Load directly in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the root directory of this repo

After editing any source file, click the reload icon on the extension card.

## Running module tests in Node

`parser.js`, `config.js`, `converter.js`, and `downloader.js` all export via `if (typeof module !== 'undefined') module.exports = ...`, so they can be tested with Node directly:

```sh
node -e "const {parseReport} = require('./src/parser'); console.log(parseReport(require('fs').readFileSync('sample.html','utf8')))"
node -e "const {slugify, applyNamingConvention} = require('./src/config'); console.log(slugify(\"O'Brien\"))"
node -e "const {detectType} = require('./src/converter'); console.log(detectType(new Uint8Array([0x25,0x50,0x44,0x46])))"
```

There is no test runner configured; tests are ad-hoc via Node one-liners or a REPL.

## Architecture

The popup runs a three-step wizard. Script load order matters — each module must be loaded before the next:

```
lib/jszip.min.js
lib/jspdf.umd.min.js
lib/mammoth.browser.min.js
  ↓
src/parser.js     → parseReport(htmlText)
src/config.js     → buildProgramRows / buildDocTypeRows / applyNamingConvention
src/converter.js  → detectType / convertToPdf
src/downloader.js → runDownload (orchestrates fetch → detect → convert → ZIP)
src/popup.js      → controller (reads all the above as globals)
```

**parser.js** — Parses a Terradotta HTML export by walking `span.H4b` (program headers) and `span.H5b` (student rows) elements in document order. Reads the first `<table>` as the field legend to build `fieldMap` (`fieldCode → { heading, prompt }`), then classifies each code as Passport or Health Form via regex.

**config.js** — Stateless utilities. `guessCode()` derives a short program code from the full name (strips common words like "Gonzaga", "in", "Study Abroad" and takes the first meaningful word — typically the location). `slugify()` makes strings safe for filenames. `applyNamingConvention()` replaces `{DOC_TYPE}`, `{LAST}`, `{FIRST}`, `{CODE}`, `{YEAR}` tokens in the user's template string.

**converter.js** — Detects file type from magic bytes (not the `Content-Type` header). Converts images to PDF via canvas + jsPDF and `.docx` files via mammoth.js → HTML → jsPDF. Returns a `status` string like `DOWNLOADED_PDF`, `CONVERTED_FROM_JPG`, `LOGIN_PAGE`, `NO_DOCUMENT`, etc. that drives the progress log colors and summary counts. `.doc`/`.rtf` are unsupported for conversion (saved as-is with `_NEEDS_REVIEW` suffix).

**downloader.js** — Builds a flat work queue from the config, then serially fetches each URL with `credentials: 'include'` (relying on the user's active Gonzaga SSO session). Assembles all files into a JSZip and appends a `download_manifest.csv`. Progress is streamed via `onProgress` callback.

**popup.js** — Holds all mutable state in a single `state` object. Step navigation is pure DOM class toggling (`active`/`done` on panels and tabs). The download ZIP is held in module-level `_zipBlob` and triggered via a programmatic `<a>` click.

## Key constraints

- **No background service worker** — all network requests run in the popup context; closing the popup aborts the download.
- **`host_permissions`** is locked to `https://studyabroad.gonzaga.edu/*`. Fetching documents from any other domain will fail.
- **CSP** (`script-src 'self'`) means no inline scripts and no remote script loading — all libraries must be bundled under `lib/`.
- The extension uses `credentials: 'include'` on every fetch, so the user must already be logged into Terradotta in the same browser profile before running a download.
