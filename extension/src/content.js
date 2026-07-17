/**
 * AI Studio PDF Export - Content Script (v2 - Fetch Based)
 * 
 * Instead of scrolling through virtual DOM, fetches the conversation
 * data directly from the same API endpoint AI Studio uses.
 * Instant, complete, accurate.
 */

(() => {
  'use strict';

  const API_BASE = 'https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource';
  const API_KEY = 'AIzaSyDdP816MREB3SkjZO04QXbjsigfcI0GWOs';

  // ============================================================
  // AUTH - Generate SAPISIDHASH from cookies
  // ============================================================

  function getSapisid() {
    const cookies = document.cookie.split(';').map(c => c.trim());
    const sapisid = cookies.find(c => c.startsWith('SAPISID='));
    if (!sapisid) return null;
    return sapisid.split('=')[1];
  }

  async function computeSapisHash(sapisid, origin) {
    const timestamp = Math.floor(Date.now() / 1000);
    const input = `${timestamp} ${sapisid} ${origin}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${timestamp}_${hashHex}`;
  }

  async function getAuthHeader() {
    const sapisid = getSapisid();
    if (!sapisid) throw new Error('Not logged in - SAPISID cookie not found');
    const origin = 'https://aistudio.google.com';
    const hash = await computeSapisHash(sapisid, origin);
    return `SAPISIDHASH ${hash} SAPISID1PHASH ${hash} SAPISID3PHASH ${hash}`;
  }

  // ============================================================
  // CONVERSATION FETCHER
  // ============================================================

  function getConversationId() {
    const match = window.location.pathname.match(/\/prompts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  async function fetchConversation() {
    const conversationId = getConversationId();
    if (!conversationId) {
      throw new Error('Not on a conversation page. Navigate to a conversation first.');
    }

    const authHeader = await getAuthHeader();
    console.log('[AI Studio PDF] Fetching conversation:', conversationId);

    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': API_KEY,
        'x-goog-authuser': '0',
        'authorization': authHeader,
      },
      body: JSON.stringify([conversationId]),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[AI Studio PDF] Data received, parsing...');
    return data;
  }

  // ============================================================
  // DATA PARSER
  // ============================================================

  function parseConversation(data) {
    // Response is wrapped: data[0] contains the actual conversation
    const convo = data?.[0];
    if (!convo) throw new Error('Empty response from API');
    
    const title = convo?.[4]?.[0] || 'AI Studio Conversation';
    const rawMessages = convo?.[13]?.[0];
    if (!rawMessages || !Array.isArray(rawMessages)) {
      throw new Error('Could not find messages in response data');
    }

    console.log(`[AI Studio PDF] Raw messages found: ${rawMessages.length}`);
    const messages = [];

    for (const msg of rawMessages) {
      if (!Array.isArray(msg)) continue;

      const text = msg[0];
      const role = msg[8];
      if (!role) continue;

      // Detect thinking blocks
      const thinkingBlocks = msg[29];
      let isThinking = false;
      if (thinkingBlocks && Array.isArray(thinkingBlocks) && thinkingBlocks.length > 0) {
        isThinking = thinkingBlocks.every(block =>
          Array.isArray(block) && block[12] === 1
        );
      }

      // Attachment-only turns
      if (!text && msg[3]) {
        messages.push({
          role,
          content: `[Attached ${msg[3].length} file(s)]`,
          isThinking: false,
        });
        continue;
      }

      if (!text) continue;

      messages.push({ role, content: text, isThinking });
    }

    console.log(`[AI Studio PDF] Parsed: ${messages.length} messages ` +
                `(${messages.filter(m => m.role === 'user').length} user, ` +
                `${messages.filter(m => m.role === 'model' && !m.isThinking).length} model, ` +
                `${messages.filter(m => m.isThinking).length} thinking)`);

    return {
      title: title + ' - Google AI Studio Conversation',
      messages,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    };
  }

  /**
   * Parse inline markdown into segments: [{ text, style }]
   */
  function parseSegments(text) {
    const segments = [];
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g;
    let last = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) segments.push({ text: text.slice(last, m.index), style: 'normal' });
      if (m[2]) segments.push({ text: m[2], style: 'bolditalic' });
      else if (m[3]) segments.push({ text: m[3], style: 'bold' });
      else if (m[4]) segments.push({ text: m[4], style: 'italic' });
      else if (m[5]) segments.push({ text: m[5], style: 'code' });
      last = m.index + m[0].length;
    }
    if (last < text.length) segments.push({ text: text.slice(last), style: 'normal' });
    return segments.length ? segments : [{ text, style: 'normal' }];
  }

  function setStyle(doc, style, fontSize, textColor, codeColor) {
    switch (style) {
      case 'bold': doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize); doc.setTextColor(...textColor); break;
      case 'italic': doc.setFont('helvetica', 'italic'); doc.setFontSize(fontSize); doc.setTextColor(...textColor); break;
      case 'bolditalic': doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(fontSize); doc.setTextColor(...textColor); break;
      case 'code': doc.setFont('courier', 'normal'); doc.setFontSize(fontSize - 1); doc.setTextColor(...codeColor); break;
      default: doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...textColor); break;
    }
  }

  /**
   * Parse inline markdown and wrap into lines that fit maxWidth.
   * Returns array of lines, where each line is an array of { text, style } segments.
   */
  function wrapMarkdownLine(doc, text, maxWidth, fontSize) {
    const segments = parseSegments(text);

    // Build word list: each word has text and style
    const words = [];
    for (const seg of segments) {
      const parts = seg.text.split(' ');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          words.push({ text: parts[i], style: seg.style });
        }
        // Add a space word between parts (not after last)
        if (i < parts.length - 1) {
          words.push({ text: ' ', style: seg.style, isSpace: true });
        }
      }
    }

    // Measure space width
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);

    // Build lines by fitting words
    const lines = [];
    let currentLine = [];
    let lineWidth = 0;

    for (const word of words) {
      setStyle(doc, word.style, fontSize, [0,0,0], [0,0,0]); // just for measuring
      const ww = doc.getTextWidth(word.text);

      if (lineWidth + ww > maxWidth && currentLine.length > 0 && !word.isSpace) {
        // Trim trailing space from current line
        while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
          currentLine.pop();
        }
        lines.push(currentLine);
        currentLine = [];
        lineWidth = 0;
        // Skip leading space on new line
        if (word.isSpace) continue;
      }

      currentLine.push(word);
      lineWidth += ww;
    }

    // Trim trailing space and push last line
    while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
      currentLine.pop();
    }
    if (currentLine.length) lines.push(currentLine);

    // Reset font
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    return lines;
  }

  // ============================================================
  // PDF GENERATOR
  // ============================================================

  function generatePDF(data) {
    const { jsPDF } = window.jspdf;
    const baseFontSize = 11;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = { top: 50, bottom: 50, left: 50, right: 50 };
    const contentWidth = pageWidth - margin.left - margin.right;
    let y = margin.top;

    const colors = {
      title: [30, 30, 60],
      userLabel: [51, 154, 240],
      modelLabel: [81, 207, 102],
      thinkingLabel: [180, 140, 60],
      text: [40, 40, 40],
      thinkingText: [80, 80, 90],
      code: [60, 60, 60],
      codeBg: [245, 245, 250],
      separator: [220, 220, 230],
      meta: [140, 140, 150],
    };

    function checkPage(needed = 20) {
      if (y + needed > pageHeight - margin.bottom) {
        doc.addPage();
        y = margin.top;
      }
    }

    // ---- TITLE ----
    y = margin.top + 40;
    doc.setFontSize(20);
    doc.setTextColor(...colors.title);
    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize(data.title, contentWidth);
    for (const line of titleLines) {
      checkPage(28);
      doc.text(line, margin.left, y);
      y += 26;
    }

    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(...colors.meta);
    doc.setFont('helvetica', 'normal');
    doc.text(`Exported: ${new Date(data.timestamp).toLocaleString()}`, margin.left, y);
    y += 14;
    doc.text(`Messages: ${data.messages.length}`, margin.left, y);
    y += 20;
    doc.setDrawColor(...colors.separator);
    doc.setLineWidth(0.5);
    doc.line(margin.left, y, pageWidth - margin.right, y);
    y += 16;

    // ---- MESSAGES ----
    for (let i = 0; i < data.messages.length; i++) {
      const msg = data.messages[i];
      const isUser = msg.role === 'user';
      checkPage(50);

      // Role label
      doc.setFontSize(baseFontSize - 1);
      doc.setFont('helvetica', 'bold');
      if (msg.isThinking) {
        doc.setTextColor(...colors.thinkingLabel);
        doc.text('MODEL (THINKING)', margin.left, y);
      } else if (isUser) {
        doc.setTextColor(...colors.userLabel);
        doc.text('USER', margin.left, y);
      } else {
        doc.setTextColor(...colors.modelLabel);
        doc.text('MODEL', margin.left, y);
      }
      y += baseFontSize + 4;

      // Content
      const textColor = msg.isThinking ? colors.thinkingText : colors.text;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...textColor);
      doc.setFontSize(baseFontSize);

      const contentLines = msg.content.split('\n');
      let inCodeBlock = false;
      let codeLines = [];

      for (const rawLine of contentLines) {
        if (rawLine.trim().startsWith('```')) {
          if (inCodeBlock) {
            const codeH = codeLines.length * (baseFontSize - 1 + 3) + 12;
            checkPage(codeH);
            doc.setFillColor(...colors.codeBg);
            doc.roundedRect(margin.left, y - 4, contentWidth, codeH, 3, 3, 'F');
            doc.setFontSize(baseFontSize - 2);
            doc.setFont('courier', 'normal');
            doc.setTextColor(...colors.code);
            y += 4;
            for (const cl of codeLines) {
              doc.text(cl, margin.left + 8, y);
              y += baseFontSize - 1 + 3;
            }
            y += 8;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...textColor);
            doc.setFontSize(baseFontSize);
            codeLines = [];
            inCodeBlock = false;
          } else {
            inCodeBlock = true;
          }
          continue;
        }

        if (inCodeBlock) {
          doc.setFontSize(baseFontSize - 2);
          doc.setFont('courier', 'normal');
          const wrapped = doc.splitTextToSize(rawLine || ' ', contentWidth - 16);
          codeLines.push(...wrapped);
          doc.setFontSize(baseFontSize);
          doc.setFont('helvetica', 'normal');
          continue;
        }

        // Heading
        const headingMatch = rawLine.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const hSize = baseFontSize + (6 - level) * 1.5;
          checkPage(hSize + 8);
          y += 4;
          doc.setFontSize(hSize);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...colors.title);
          const hWrapped = doc.splitTextToSize(headingMatch[2], contentWidth);
          for (const hl of hWrapped) {
            doc.text(hl, margin.left, y);
            y += hSize + 2;
          }
          y += 2;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...textColor);
          doc.setFontSize(baseFontSize);
          continue;
        }

        // Empty line
        if (!rawLine.trim()) {
          y += 6;
          continue;
        }

        // List items (bullet)
        const bulletMatch = rawLine.match(/^(\s*)[*\-]\s+(.+)/);
        const numMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.+)/);

        if (bulletMatch && !rawLine.match(/^\*\*[^*]+\*\*/)) {
          const indent = Math.min(bulletMatch[1].length / 4, 3) * 16;
          const lines = wrapMarkdownLine(doc, '\u2022 ' + bulletMatch[2], contentWidth - indent, baseFontSize);
          for (const segs of lines) {
            checkPage(baseFontSize + 3);
            let x = margin.left + indent;
            for (const seg of segs) {
              setStyle(doc, seg.style, baseFontSize, textColor, colors.code);
              doc.text(seg.text, x, y);
              x += doc.getTextWidth(seg.text);
            }
            y += baseFontSize + 3;
          }
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...textColor);
          continue;
        }

        if (numMatch) {
          const indent = Math.min(numMatch[1].length / 4, 3) * 16;
          const lines = wrapMarkdownLine(doc, numMatch[2] + '. ' + numMatch[3], contentWidth - indent, baseFontSize);
          for (const segs of lines) {
            checkPage(baseFontSize + 3);
            let x = margin.left + indent;
            for (const seg of segs) {
              setStyle(doc, seg.style, baseFontSize, textColor, colors.code);
              doc.text(seg.text, x, y);
              x += doc.getTextWidth(seg.text);
            }
            y += baseFontSize + 3;
          }
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...textColor);
          continue;
        }

        // Regular text with inline markdown
        const lines = wrapMarkdownLine(doc, rawLine, contentWidth, baseFontSize);
        for (const segs of lines) {
          checkPage(baseFontSize + 3);
          let x = margin.left;
          for (const seg of segs) {
            setStyle(doc, seg.style, baseFontSize, textColor, colors.code);
            doc.text(seg.text, x, y);
            x += doc.getTextWidth(seg.text);
          }
          y += baseFontSize + 3;
        }
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textColor);
      }

      // Close unclosed code block
      if (inCodeBlock && codeLines.length > 0) {
        const codeH = codeLines.length * (baseFontSize - 1 + 3) + 12;
        checkPage(codeH);
        doc.setFillColor(...colors.codeBg);
        doc.roundedRect(margin.left, y - 4, contentWidth, codeH, 3, 3, 'F');
        doc.setFontSize(baseFontSize - 2);
        doc.setFont('courier', 'normal');
        doc.setTextColor(...colors.code);
        y += 4;
        for (const cl of codeLines) {
          doc.text(cl, margin.left + 8, y);
          y += baseFontSize - 1 + 3;
        }
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textColor);
        doc.setFontSize(baseFontSize);
      }

      // Separator
      y += 8;
      if (i < data.messages.length - 1) {
        checkPage(10);
        doc.setDrawColor(...colors.separator);
        doc.setLineWidth(0.3);
        doc.line(margin.left, y, pageWidth - margin.right, y);
        y += 14;
      }
    }

    // Page numbers
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(9);
      doc.setTextColor(...colors.meta);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth / 2, pageHeight - 25, { align: 'center' });
    }

    return doc;
  }

  // ============================================================
  // MAIN EXPORT FLOW
  // ============================================================

  async function exportConversation(btn) {
    try {
      btn.disabled = true;
      btn.querySelector('span').textContent = 'Fetching...';

      const rawData = await fetchConversation();

      btn.querySelector('span').textContent = 'Parsing...';
      const data = parseConversation(rawData);

      btn.querySelector('span').textContent = `Building PDF (${data.messages.length} msgs)...`;
      await new Promise(r => setTimeout(r, 50));

      const doc = generatePDF(data);

      const filename = (data.title || 'ai-studio-conversation')
        .replace(/[^a-zA-Z0-9\s\-_]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 100) + '.pdf';
      doc.save(filename);

      btn.querySelector('span').textContent = 'Done!';
      setTimeout(() => {
        btn.querySelector('span').textContent = 'Export PDF';
        btn.disabled = false;
      }, 2000);

    } catch (err) {
      console.error('[AI Studio PDF] Export error:', err);
      btn.querySelector('span').textContent = 'Error: ' + err.message;
      setTimeout(() => {
        btn.querySelector('span').textContent = 'Export PDF';
        btn.disabled = false;
      }, 3000);
    }
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapeConversation') {
      fetchConversation()
        .then(raw => {
          const data = parseConversation(raw);
          sendResponse({ success: true, data });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'ping') {
      sendResponse({ alive: true, url: window.location.href });
      return true;
    }
  });

  // ============================================================
  // FLOATING BUTTON
  // ============================================================

  function injectFloatingButton() {
    if (document.getElementById('aistudio-pdf-export-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'aistudio-pdf-export-btn';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      <span>Export PDF</span>
    `;
    btn.title = 'Export conversation to PDF';
    btn.addEventListener('click', () => exportConversation(btn));
    document.body.appendChild(btn);
  }

  if (document.readyState === 'complete') {
    injectFloatingButton();
  } else {
    window.addEventListener('load', injectFloatingButton);
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById('aistudio-pdf-export-btn')) {
      injectFloatingButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });

  console.log('[AI Studio PDF Export] Content script loaded (v2 - fetch based)');
})();
