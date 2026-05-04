// Strip HTML to plain text suitable for Claude prompts.
// Regex-based — no external parser needed, works in both Workers and Node.js.
export function stripHtml(html: string, maxLength = 4000): string {
  const text = html
    // Remove script / style / invisible element blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|figure|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Block elements → newline so paragraphs stay separated
    .replace(/<\/?(p|div|h[1-6]|li|br|tr|blockquote|section|article)[^>]*>/gi, '\n')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    // Normalise whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}
