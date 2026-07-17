# AI Studio PDF Export

Chrome extension that exports Google AI Studio conversations to accurate, well-formatted PDFs.

## What It Is

AI Studio PDF Export is a Chrome extension that saves any Google AI Studio conversation as a formatted PDF without leaving the browser. Instead of scraping the visible page, it intercepts the same internal API request that AI Studio uses to load conversations, pulling the raw data directly and accurately regardless of how long the chat is. Authentication is handled automatically by reading your existing SAPISID session cookie and computing a SAPISIDHASH token, so no login or separate API key is required. The extension formats the conversation with clearly labeled user and model turns, applies your chosen font size and paper dimensions, and generates the PDF entirely client-side using jsPDF. No data leaves your machine and no server is involved. The output captures the full conversation including long responses and code blocks that a standard browser print-to-PDF would cut off or mangle. A floating button appears on every AI Studio conversation page for one-click export, and the extension popup gives you additional controls before generating the file.

## Download

1. Click the green **Code** button at the top of this page
2. Click **Download ZIP**
3. Extract the ZIP file to a folder on your computer

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the extracted folder
5. Navigate to [Google AI Studio](https://aistudio.google.com) and start a conversation

## Usage

### Option 1: Floating Button
A blue "Export PDF" button appears in the bottom-right corner of any AI Studio conversation. Click it to export.

### Option 2: Extension Popup
Click the extension icon in your Chrome toolbar. The popup will:
- Automatically scan the current conversation
- Show message count and word count
- Show a preview of messages
- Let you configure paper size and font size
- Export to PDF

## Architecture

```
├── manifest.json          # MV3 manifest
├── icons/                 # Extension icons
├── lib/
│   └── jspdf.umd.min.js  # PDF generation library
└── src/
    ├── content.js         # DOM scraper (injected into AI Studio)
    ├── content.css        # Floating button styles
    ├── background.js      # Service worker
    ├── popup.html         # Extension popup UI
    └── popup.js           # Popup logic + PDF generation
```

## How the Scraper Works

The scraper uses a **multi-strategy selector approach**:

1. Tries specific selectors for AI Studio components (`ms-chat-turn`, etc.)
2. Falls back to generic class-based selectors (`[class*="chat-turn"]`)
3. Uses heuristic detection if nothing else works
4. Role detection uses data attributes → class names → text patterns → alternating fallback

If Google updates their DOM structure, update the `SELECTORS` object at the top of `content.js`.

## Updating Selectors

When Google changes the AI Studio DOM:

1. Open AI Studio in Chrome
2. Right-click a message → Inspect
3. Note the element structure (tag names, classes, data attributes)
4. Update the selectors in `content.js` → `SELECTORS` object
5. Reload the extension

## Known Limitations

- Google AI Studio is an Angular SPA; DOM structure may change without notice
- Very long conversations may take a few seconds to fully scrape (lazy loading)
- Code block syntax highlighting is not preserved in PDF (text only)
- Tables are rendered as pipe-delimited text
- Images/charts in conversations are not captured

## Tech Stack

- **Manifest V3** (required for Chrome Web Store)
- **jsPDF** for client-side PDF generation
- **Vanilla JS** (no framework dependencies)
