# Terradotta Document Downloader

A Chrome Extension for Gonzaga University's Study Abroad office.

## Prerequisites

- Chrome (or any Chromium-based browser)
- An active Gonzaga SSO session at `studyabroad.gonzaga.edu` in the same browser profile
- A Terradotta **Questionnaire Response Report** exported as HTML

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder

## Usage

1. **Export** — In Terradotta, run the Questionnaire Response Report and export as HTML
2. **Sign in** — Go to `studyabroad.gonzaga.edu` and sign in with your Gonzaga credentials
3. **Upload** — Drop or browse to your Terradotta HTML export
4. **Configure** — Review the auto-detected programs and document types; edit short codes, years, and the file naming template as needed
5. **Download** — The extension fetches each document and streams progress in real time. When complete, click **Download ZIP**

## Support
Email Tony at `cnguyen4@zagmail.gonzagal.edu`.

### Naming template tokens

| Token | Value |
|---|---|
| `{DOC_TYPE}` | Document type name (e.g. `Passport`) |
| `{LAST}` | Student last name |
| `{FIRST}` | Student first name |
| `{CODE}` | Program short code (e.g. `Florence`) |
| `{YEAR}` | Program year (e.g. `2026`) |

Default: `{DOC_TYPE}_{LAST}_{FIRST}_{CODE}{YEAR}`

### ZIP structure

```
Barcelona/
  Passport/
    Passport_Smith_Jane_Barcelona2026.pdf
  Health_Form/
    Health_Form_Smith_Jane_Barcelona2026.pdf
download_manifest.csv
```

Files that could not be converted (legacy `.doc`, `.rtf`) are saved as-is with a `_NEEDS_REVIEW` suffix. The manifest CSV logs the status of every attempted download.

## Status codes in the manifest

| Status | Meaning |
|---|---|
| `DOWNLOADED_PDF` | PDF fetched directly |
| `CONVERTED_FROM_JPG` / `_PNG` etc. | Image converted to PDF |
| `CONVERTED_FROM_DOCX` | Word document converted to PDF |
| `LOGIN_PAGE` | Session expired — log in and retry |
| `NO_DOCUMENT` | Student did not upload this document |
| `NOT_UPLOADED` | Unrecognised file type |
| `WORD_UNSUPPORTED_FORMAT` | `.doc` or `.rtf` — saved as-is |
| `ERROR` | Network or conversion failure |

## Notes

- Closing the popup while a download is in progress will abort it — keep the popup open until complete.
- The extension can only reach `https://studyabroad.gonzaga.edu/*`. Documents hosted elsewhere will fail.
