import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))

import { handleSlashCommand } from '../../src/core/slash-commands'
import { sendReply } from '../../src/integrations/line'

const mockSendReply = vi.mocked(sendReply)
const mockEnv = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
} as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleSlashCommand', () => {
  it('returns null for regular non-slash text', async () => {
    const result = await handleSlashCommand('大湖公園', 'reply-token', mockEnv)
    expect(result).toBeNull()
    expect(mockSendReply).not.toHaveBeenCalled()
  })

  it('returns null for unrecognized slash command (falls through to LLM router)', async () => {
    const result = await handleSlashCommand('/unknown', 'reply-token', mockEnv)
    expect(result).toBeNull()
  })

  describe('/help', () => {
    it('sends help message and returns replied', async () => {
      const result = await handleSlashCommand('/help', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      expect(mockSendReply).toHaveBeenCalledOnce()
    })

    it('help message contains capability description', async () => {
      await handleSlashCommand('/help', 'reply-token', mockEnv)
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('親子景點')
    })

    it('help message lists slash commands', async () => {
      await handleSlashCommand('/help', 'reply-token', mockEnv)
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('/help')
      expect(sentText).toContain('/place')
    })

    it('is case-insensitive', async () => {
      const result = await handleSlashCommand('/HELP', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
    })
  })

  describe('/place', () => {
    it('returns route outcome with places capability and input text', async () => {
      const result = await handleSlashCommand('/place 大湖公園划船', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'route', capability: 'places', input: '大湖公園划船' })
      expect(mockSendReply).not.toHaveBeenCalled()
    })

    it('sends error reply and returns replied when no args provided', async () => {
      const result = await handleSlashCommand('/place', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      expect(mockSendReply).toHaveBeenCalledOnce()
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('/place')
    })

    it('supports multi-word place input', async () => {
      const result = await handleSlashCommand('/place 大湖公園 划船 台北', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'route', capability: 'places', input: '大湖公園 划船 台北' })
    })
  })
})
