import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchMessageContent, isImageMessage } from '../../src/integrations/line'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeArrayBuffer(bytes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length)
  const view = new Uint8Array(buffer)
  bytes.forEach((b, i) => { view[i] = b })
  return buffer
}

describe('isImageMessage', () => {
  it('returns true for image message', () => {
    expect(isImageMessage({ type: 'image', id: 'msg-1' })).toBe(true)
  })

  it('returns false for text message', () => {
    expect(isImageMessage({ type: 'text', id: 'msg-1', text: 'hello' })).toBe(false)
  })

  it('returns false for other message types', () => {
    expect(isImageMessage({ type: 'sticker', id: 'msg-1' })).toBe(false)
  })
})

describe('fetchMessageContent', () => {
  it('fetches from correct LINE content API URL with Bearer auth', async () => {
    const buffer = makeArrayBuffer([0x89, 0x50])
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    await fetchMessageContent('msg-123', 'access-token')

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api-data.line.me/v2/bot/message/msg-123/content',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    )
  })

  it('returns mimeType from content-type header', async () => {
    const buffer = makeArrayBuffer([1, 2, 3])
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === 'content-type' ? 'image/png' : null },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    const result = await fetchMessageContent('msg-1', 'token')
    expect(result.mimeType).toBe('image/png')
  })

  it('strips charset from content-type', async () => {
    const buffer = makeArrayBuffer([1, 2])
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === 'content-type' ? 'image/jpeg; charset=utf-8' : null },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    const result = await fetchMessageContent('msg-1', 'token')
    expect(result.mimeType).toBe('image/jpeg')
  })

  it('reports correct sizeBytes', async () => {
    const buffer = makeArrayBuffer([0, 1, 2, 3, 4])
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    const result = await fetchMessageContent('msg-1', 'token')
    expect(result.sizeBytes).toBe(5)
  })

  it('returns base64-encoded contentBase64', async () => {
    const buffer = makeArrayBuffer([72, 101, 108, 108, 111]) // "Hello"
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    const result = await fetchMessageContent('msg-1', 'token')
    expect(result.contentBase64).toBe(Buffer.from('Hello').toString('base64'))
  })

  it('throws when LINE API returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
    } as unknown as Response)

    await expect(fetchMessageContent('msg-1', 'token')).rejects.toThrow('LINE content API failed: 403')
  })

  it('falls back to image/jpeg when content-type header is missing', async () => {
    const buffer = makeArrayBuffer([1])
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Response)

    const result = await fetchMessageContent('msg-1', 'token')
    expect(result.mimeType).toBe('image/jpeg')
  })
})
