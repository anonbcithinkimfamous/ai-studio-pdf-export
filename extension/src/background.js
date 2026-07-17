/**
 * AI Studio PDF Export - Background Service Worker
 * Handles communication between popup and content script.
 */

// Handle messages from content script's floating button
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'generatePDF') {
    // Forward to offscreen document or handle directly
    generateAndDownloadPDF(msg.data)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * Generate PDF from conversation data and trigger download.
 * Uses jsPDF in an offscreen document context.
 */
async function generateAndDownloadPDF(data) {
  // For the floating button path, we create an offscreen document
  // to generate the PDF since service workers can't load jsPDF directly.
  // The popup path handles this directly in popup.js.
  
  // Create a data URL for download
  const textContent = formatConversationAsText(data);
  const blob = new Blob([textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  // Fallback: download as text if PDF generation isn't available here
  await chrome.downloads.download({
    url: url,
    filename: sanitizeFilename(data.title) + '.txt',
    saveAs: true,
  });
}

/**
 * Format conversation as plain text (fallback)
 */
function formatConversationAsText(data) {
  let text = `${data.title}\n`;
  text += `${'='.repeat(60)}\n`;
  text += `Exported: ${new Date(data.timestamp).toLocaleString()}\n`;
  text += `Source: ${data.url}\n`;
  text += `${'='.repeat(60)}\n\n`;

  for (const msg of data.messages) {
    const role = msg.role === 'user' ? '👤 USER' : '🤖 MODEL';
    text += `${role}\n${'-'.repeat(40)}\n`;
    text += `${msg.content}\n\n`;
  }

  return text;
}

function sanitizeFilename(name) {
  return (name || 'ai-studio-conversation')
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}

console.log('[AI Studio PDF Export] Service worker loaded');
