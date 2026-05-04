import { describe, it, expect } from 'vitest'
import { stripHtml } from '../../src/lib/html-extract'

describe('stripHtml', () => {
  it('removes script blocks', () => {
    expect(stripHtml('<script>alert("xss")</script>Hello')).toBe('Hello')
  })

  it('removes style blocks', () => {
    expect(stripHtml('<style>body{color:red}</style>Text')).toBe('Text')
  })

  it('removes nav, footer, header blocks', () => {
    expect(stripHtml('<nav>menu</nav><p>Content</p><footer>footer</footer>')).toContain('Content')
    expect(stripHtml('<nav>menu</nav><p>Content</p><footer>footer</footer>')).not.toContain('menu')
    expect(stripHtml('<nav>menu</nav><p>Content</p><footer>footer</footer>')).not.toContain('footer')
  })

  it('strips all remaining HTML tags', () => {
    const result = stripHtml('<div><p>Hello <strong>world</strong></p></div>')
    expect(result).toContain('Hello')
    expect(result).toContain('world')
    expect(result).not.toMatch(/<[^>]+>/)
  })

  it('decodes HTML entities', () => {
    const result = stripHtml('&amp; &lt; &gt; &quot; &#39; &nbsp;')
    expect(result).toBe('& < > " \'')
  })

  it('collapses multiple spaces to single space', () => {
    const result = stripHtml('Hello     World')
    expect(result).toBe('Hello World')
  })

  it('collapses excessive newlines', () => {
    const result = stripHtml('<p>A</p>\n\n\n\n\n<p>B</p>')
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('truncates at maxLength and appends ellipsis', () => {
    const long = 'a'.repeat(5000)
    const result = stripHtml(long, 100)
    expect(result.length).toBe(101) // 100 + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not truncate content within limit', () => {
    const result = stripHtml('Hello World', 100)
    expect(result).toBe('Hello World')
    expect(result.endsWith('…')).toBe(false)
  })

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('')
  })
})
