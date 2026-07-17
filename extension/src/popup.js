/**
 * AI Studio PDF Export - Popup Script
 * 
 * Coordinates between the content script (scraping) and jsPDF (generation).
 */

const { jsPDF } = window.jspdf;

// DOM refs
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const previewEl = document.getElementById('preview');
const optionsEl = document.getElementById('optionsSection');
const btnExport = document.getElementById('btnExport');
const btnLabel = document.getElementById('btnLabel');
const msgCountEl = document.getElementById('msgCount');
const wordCountEl = document.getElementById('wordCount');

let conversationData = null;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('aistudio.google.com')) {
      setStatus('error', 'Navigate to Google AI Studio to export a conversation.');
      return;
    }

    setStatus('working', 'Scanning conversation...');

    // Send message to content script to scrape
    chrome.tabs.sendMessage(tab.id, { action: 'scrapeConversation' }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('error', 'Content script not loaded. Try refreshing the page.');
        return;
      }

      if (!response?.success) {
        setStatus('error', response?.error || 'Failed to scrape conversation.');
        return;
      }

      conversationData = response.data;
      onConversationLoaded(conversationData);
    });
  } catch (err) {
    setStatus('error', `Error: ${err.message}`);
  }
}

// ============================================================
// UI UPDATES
// ============================================================

function setStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = type === 'working'
    ? `<div class="spinner"></div><span>${message}</span>`
    : `<span>${message}</span>`;
}

function onConversationLoaded(data) {
  const msgCount = data.messages.length;
  const wordCount = data.messages.reduce((sum, m) => {
    return sum + m.content.split(/\s+/).filter(Boolean).length;
  }, 0);

  // Update stats
  msgCountEl.textContent = msgCount;
  wordCountEl.textContent = wordCount.toLocaleString();
  statsEl.classList.remove('hidden');

  // Build preview
  let previewHtml = '';
  const previewMsgs = data.messages.slice(0, 4);
  for (const msg of previewMsgs) {
    const roleLabel = msg.role === 'user' ? 'You' : 'Model';
    const snippet = msg.content.slice(0, 100).replace(/</g, '&lt;');
    previewHtml += `
      <div class="msg">
        <div class="role ${msg.role}">${roleLabel}</div>
        <div class="text">${snippet}${msg.content.length > 100 ? '...' : ''}</div>
      </div>
    `;
  }
  if (data.messages.length > 4) {
    previewHtml += `<div class="msg"><div class="text" style="color:#666;text-align:center;">... and ${data.messages.length - 4} more messages</div></div>`;
  }
  previewEl.innerHTML = previewHtml;
  previewEl.classList.remove('hidden');

  // Show options
  optionsEl.classList.remove('hidden');

  // Enable export
  btnExport.disabled = false;
  setStatus('success', `Found ${msgCount} messages (${data.title})`);
}

// ============================================================
// PDF GENERATION
// ============================================================

function generatePDF(data, options = {}) {
  const paperSize = options.paperSize || 'letter';
  const baseFontSize = parseInt(options.fontSize) || 11;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: paperSize,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = { top: 50, bottom: 50, left: 50, right: 50 };
  const contentWidth = pageWidth - margin.left - margin.right;
  let y = margin.top;

  // Colors
  const colors = {
    title: [30, 30, 60],
    userLabel: [51, 154, 240],
    modelLabel: [81, 207, 102],
    text: [40, 40, 40],
    code: [60, 60, 60],
    codeBg: [245, 245, 250],
    separator: [220, 220, 230],
    meta: [140, 140, 150],
  };

  // Helper: check if we need a new page
  function checkPage(needed = 20) {
    if (y + needed > pageHeight - margin.bottom) {
      doc.addPage();
      y = margin.top;
      addPageNumber();
      return true;
    }
    return false;
  }

  // Helper: add page numbers
  let pageNum = 1;
  function addPageNumber() {
    pageNum++;
  }

  function addAllPageNumbers() {
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(...colors.meta);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 25, { align: 'center' });
    }
  }

  // ---- TITLE PAGE ----
  y = margin.top + 60;
  doc.setFontSize(22);
  doc.setTextColor(...colors.title);
  doc.setFont('helvetica', 'bold');

  const titleLines = doc.splitTextToSize(data.title, contentWidth);
  for (const line of titleLines) {
    checkPage(30);
    doc.text(line, margin.left, y);
    y += 28;
  }

  y += 10;
  doc.setFontSize(10);
  doc.setTextColor(...colors.meta);
  doc.setFont('helvetica', 'normal');
  doc.text(`Exported: ${new Date(data.timestamp).toLocaleString()}`, margin.left, y);
  y += 16;
  doc.text(`Source: ${data.url}`, margin.left, y);
  y += 16;
  doc.text(`Messages: ${data.messages.length}`, margin.left, y);
  y += 30;

  // Separator line
  doc.setDrawColor(...colors.separator);
  doc.setLineWidth(0.5);
  doc.line(margin.left, y, pageWidth - margin.right, y);
  y += 20;

  // ---- MESSAGES ----
  for (let i = 0; i < data.messages.length; i++) {
    const msg = data.messages[i];
    const isUser = msg.role === 'user';

    checkPage(60);

    // Role label
    doc.setFontSize(baseFontSize - 1);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(isUser ? colors.userLabel : colors.modelLabel));
    doc.text(isUser ? 'USER' : 'MODEL', margin.left, y);
    y += baseFontSize + 4;

    // Message content
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.text);

    const lines = processContent(doc, msg.content, contentWidth, baseFontSize, margin, colors);

    for (const lineObj of lines) {
      checkPage(lineObj.height + 2);

      if (lineObj.type === 'text') {
        doc.setFontSize(lineObj.fontSize || baseFontSize);
        doc.setFont('helvetica', lineObj.bold ? 'bold' : (lineObj.italic ? 'italic' : 'normal'));
        doc.setTextColor(...(lineObj.color || colors.text));
        doc.text(lineObj.text, lineObj.x || margin.left, y);
        y += lineObj.height;
      } else if (lineObj.type === 'code') {
        // Code block background
        const codeHeight = lineObj.lines.length * (baseFontSize - 1 + 3) + 12;
        checkPage(codeHeight);

        doc.setFillColor(...colors.codeBg);
        doc.roundedRect(margin.left, y - 4, contentWidth, codeHeight, 4, 4, 'F');

        doc.setFontSize(baseFontSize - 2);
        doc.setFont('courier', 'normal');
        doc.setTextColor(...colors.code);

        y += 6;
        for (const codeLine of lineObj.lines) {
          doc.text(codeLine, margin.left + 8, y);
          y += baseFontSize - 1 + 3;
        }
        y += 8;

        doc.setFont('helvetica', 'normal');
      } else if (lineObj.type === 'heading') {
        doc.setFontSize(lineObj.fontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.title);
        doc.text(lineObj.text, margin.left, y);
        y += lineObj.height;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...colors.text);
      } else if (lineObj.type === 'spacer') {
        y += lineObj.height;
      }
    }

    // Separator between messages
    y += 8;
    if (i < data.messages.length - 1) {
      checkPage(10);
      doc.setDrawColor(...colors.separator);
      doc.setLineWidth(0.3);
      doc.line(margin.left, y, pageWidth - margin.right, y);
      y += 14;
    }
  }

  // Add page numbers to all pages
  addAllPageNumbers();

  return doc;
}

/**
 * Process message content into renderable line objects.
 */
function processContent(doc, content, maxWidth, baseFontSize, margin, colors) {
  const lines = [];
  const contentLines = content.split('\n');
  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = '';

  for (const rawLine of contentLines) {
    // Code block start/end
    if (rawLine.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        lines.push({ type: 'code', lines: codeLines, lang: codeLang, height: 0 });
        codeLines = [];
        inCodeBlock = false;
        codeLang = '';
      } else {
        // Start code block
        inCodeBlock = true;
        codeLang = rawLine.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      // Wrap long code lines
      doc.setFontSize(baseFontSize - 2);
      doc.setFont('courier', 'normal');
      const wrapped = doc.splitTextToSize(rawLine || ' ', maxWidth - 16);
      codeLines.push(...wrapped);
      continue;
    }

    // Headings
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingSize = baseFontSize + (6 - level) * 1.5;
      lines.push({ type: 'spacer', height: 6 });
      lines.push({
        type: 'heading',
        text: headingMatch[2],
        fontSize: headingSize,
        height: headingSize + 6,
      });
      continue;
    }

    // Empty line = spacer
    if (!rawLine.trim()) {
      lines.push({ type: 'spacer', height: 6 });
      continue;
    }

    // Regular text - wrap to fit
    doc.setFontSize(baseFontSize);
    doc.setFont('helvetica', 'normal');

    // Check for bold/italic markers (simplified)
    let text = rawLine;
    let bold = false;
    let italic = false;

    if (text.startsWith('**') && text.endsWith('**')) {
      bold = true;
      text = text.slice(2, -2);
    } else if (text.startsWith('*') && text.endsWith('*')) {
      italic = true;
      text = text.slice(1, -1);
    }

    // Bullet points
    if (text.startsWith('• ') || text.startsWith('- ')) {
      doc.setFont('helvetica', 'normal');
      const bulletText = text;
      const wrapped = doc.splitTextToSize(bulletText, maxWidth - 12);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push({
          type: 'text',
          text: wrapped[i],
          x: margin.left + (i === 0 ? 0 : 12),
          height: baseFontSize + 3,
          bold: false,
        });
      }
      continue;
    }

    // Numbered lists
    const numMatch = text.match(/^(\d+)\.\s/);
    if (numMatch) {
      const wrapped = doc.splitTextToSize(text, maxWidth - 12);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push({
          type: 'text',
          text: wrapped[i],
          x: margin.left + (i === 0 ? 0 : 16),
          height: baseFontSize + 3,
          bold: false,
        });
      }
      continue;
    }

    // Regular paragraph text
    const wrapped = doc.splitTextToSize(text, maxWidth);
    for (const wl of wrapped) {
      lines.push({
        type: 'text',
        text: wl,
        height: baseFontSize + 3,
        bold,
        italic,
      });
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    lines.push({ type: 'code', lines: codeLines, lang: codeLang, height: 0 });
  }

  return lines;
}

// ============================================================
// EXPORT HANDLER
// ============================================================

btnExport.addEventListener('click', async () => {
  if (!conversationData) return;

  btnExport.disabled = true;
  btnLabel.textContent = 'Generating PDF...';
  setStatus('working', 'Generating PDF...');

  try {
    // Small delay for UI update
    await new Promise(r => setTimeout(r, 50));

    const options = {
      paperSize: document.getElementById('paperSize').value,
      fontSize: document.getElementById('fontSize').value,
    };

    const doc = generatePDF(conversationData, options);

    // Generate filename
    const filename = sanitizeFilename(conversationData.title) + '.pdf';

    // Save
    doc.save(filename);

    setStatus('success', `Saved as ${filename}`);
    btnLabel.textContent = 'Exported!';

    setTimeout(() => {
      btnLabel.textContent = 'Export to PDF';
      btnExport.disabled = false;
    }, 2000);

  } catch (err) {
    console.error('[AI Studio PDF] Generation error:', err);
    setStatus('error', `PDF generation failed: ${err.message}`);
    btnLabel.textContent = 'Export to PDF';
    btnExport.disabled = false;
  }
});

function sanitizeFilename(name) {
  return (name || 'ai-studio-conversation')
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}

// ============================================================
// START
// ============================================================
init();
