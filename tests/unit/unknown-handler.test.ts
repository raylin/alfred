import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))

import { buildUnknownMessage, handleUnknown } from '../../src/core/unknown-handler'
import { sendReply } from '../../src/integrations/line'

const mockSendReply = vi.mocked(sendReply)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildUnknownMessage', () => {
  it('includes capability descriptions', () => {
    const msg = buildUnknownMessage()
    expect(msg).toContain('親子景點')
  })

  it('includes /help hint', () => {
    const msg = buildUnknownMessage()
    expect(msg).toContain('/help')
  })

  it('returns a non-empty string', () => {
    const msg = buildUnknownMessage()
    expect(msg.length).toBeGreaterThan(10)
  })
})

describe('handleUnknown', () => {
  it('calls sendReply with the unknown message', async () => {
    await handleUnknown('reply-token', 'access-token')
    expect(mockSendReply).toHaveBeenCalledOnce()
    expect(mockSendReply.mock.calls[0][0]).toBe('reply-token')
    expect(mockSendReply.mock.calls[0][2]).toBe('access-token')
  })

  it('sends a text message type', async () => {
    await handleUnknown('reply-token', 'access-token')
    const messages = mockSendReply.mock.calls[0][1]
    expect(messages[0]).toHaveProperty('type', 'text')
  })
})
