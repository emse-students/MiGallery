// Very small Markdown -> HTML converter for trusted local docs.
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function mdToHtml(md: string) {
  if (!md) return '';

  // Normalize line endings
  md = md.replace(/\r\n/g, '\n');

  // Handle code fences ```
  md = md.replace(/```([\s\S]*?)```/g, (_, code) => {
    const esc = escapeHtml(code);
    return `<pre><code>${esc}</code></pre>`;
  });

  // Inline code: `code`
  md = md.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);

  // Headings
  md = md.replace(/^######\s*(.+)$/gm, '<h6>$1</h6>');
  md = md.replace(/^#####\s*(.+)$/gm, '<h5>$1</h5>');
  md = md.replace(/^####\s*(.+)$/gm, '<h4>$1</h4>');
  md = md.replace(/^###\s*(.+)$/gm, '<h3>$1</h3>');
  md = md.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  md = md.replace(/^#\s*(.+)$/gm, '<h1>$1</h1>');

  // Lists (unordered)
  md = md.replace(/(^|\n)([ \t]*[-\*]\s+.+)(\n|$)/g, (m, pre, list) => {
  const items = list.split(/\n/).map((l: string) => l.replace(/^\s*[-\*]\s+/, '').trim()).filter(Boolean).map((i: string) => escapeHtml(i));
  return `${pre}<ul>${items.map((i: string) => `<li>${i}</li>`).join('')}</ul>`;
  });

  // Links [text](url)
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`);

  // Bold **text**
  md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Paragraphs: wrap standalone lines
  const lines = md.split('\n');
  const out: string[] = [];
  let inPre = false;
  for (let line of lines) {
    if (line.startsWith('<pre>')) inPre = true;
    if (inPre) {
      out.push(line);
      if (line.endsWith('</pre>')) inPre = false;
      continue;
    }
    if (/^<h[1-6]>/.test(line) || /^<ul>/.test(line) || /^<pre>/.test(line) || /^<blockquote>/.test(line) || /^<p>/.test(line)) {
      out.push(line);
    } else if (line.trim() === '') {
      out.push('');
    } else {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  return out.join('\n');
}
