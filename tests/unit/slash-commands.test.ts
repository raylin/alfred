import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }

vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/home-store', () => ({
  getHomeLocation: vi.fn(),
  clearCurrentOrigin: vi.fn().mockResolvedValue(undefined),
  markHomeUpdatePending: vi.fn().mockResolvedValue(undefined),
}))

import { handleSlashCommand } from '../../src/core/slash-commands'
import { sendReply } from '../../src/integrations/line'
import { getHomeLocation, clearCurrentOrigin, markHomeUpdatePending } from '../../src/capabilities/places/home-store'

const mockSendReply = vi.mocked(sendReply)
const mockGetHome = vi.mocked(getHomeLocation)
const mockClearOrigin = vi.mocked(clearCurrentOrigin)
const mockMarkPending = vi.mocked(markHomeUpdatePending)
const mockEnv = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  PM_LINE_USER_ID: 'PM_USER',
  ALFRED_KV: mockKv,
} as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
  mockKv.get.mockResolvedValue(null)
  mockKv.put.mockResolvedValue(undefined)
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

  describe('/setup', () => {
    it('replies with error when no userId (group context)', async () => {
      const result = await handleSlashCommand('/setup', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('私訊')
    })

    it('sets pending flag and shows update prompt when home is set', async () => {
      mockGetHome.mockResolvedValueOnce({ lat: 25.05, lng: 121.52, address: '台北市大安區' })
      const result = await handleSlashCommand('/setup', 'reply-token', mockEnv, 'U001')
      expect(result).toEqual({ type: 'replied' })
      expect(mockMarkPending).toHaveBeenCalledWith(mockEnv, 'U001')
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('台北市大安區')
      expect(sentText).toContain('5 分鐘')
    })

    it('shows setup prompt when no home set', async () => {
      mockGetHome.mockResolvedValueOnce(null)
      const result = await handleSlashCommand('/setup', 'reply-token', mockEnv, 'U001')
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('位置')
    })
  })

  describe('/home', () => {
    it('replies with error when no userId (group context)', async () => {
      const result = await handleSlashCommand('/home', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('私訊')
    })

    it('clears current_origin and replies when userId provided', async () => {
      const result = await handleSlashCommand('/home', 'reply-token', mockEnv, 'U001')
      expect(result).toEqual({ type: 'replied' })
      expect(mockClearOrigin).toHaveBeenCalledWith(mockEnv, 'U001')
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('家裡')
    })
  })

  describe('/here', () => {
    it('replies with location-share instructions', async () => {
      const result = await handleSlashCommand('/here', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('位置')
      expect(sentText).toContain('2 小時')
    })
  })

  describe('/review', () => {
    function makeEvent(type: string, outcome: 'success' | 'error' | 'unknown' = 'success', durationMs = 100) {
      return JSON.stringify({
        ulid: `01JXZ${Math.random().toString(36).slice(2, 22).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        type,
        outcome,
        duration_ms: durationMs,
      })
    }

    it('rejects non-PM users with 管理員 message', async () => {
      const result = await handleSlashCommand('/review', 'reply-token', mockEnv, 'OTHER_USER')
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('管理員')
    })

    it('rejects group context (no userId) with 1:1 message', async () => {
      const result = await handleSlashCommand('/review', 'reply-token', mockEnv)
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('1:1')
    })

    it('replies with no-events message when ring buffer is empty', async () => {
      mockKv.get.mockResolvedValue(null) // no events:recent
      const result = await handleSlashCommand('/review', 'reply-token', mockEnv, 'PM_USER')
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('沒有')
    })

    it('produces summary for PM user with events', async () => {
      const ulid1 = '01JXZ0000000000000000000AA'
      const ulid2 = '01JXZ0000000000000000000BB'
      mockKv.get.mockImplementation((key: string) => {
        if (key === 'events:recent') return Promise.resolve(JSON.stringify([ulid1, ulid2]))
        if (key === `event:${ulid1}`) return Promise.resolve(makeEvent('places.search', 'success', 200))
        if (key === `event:${ulid2}`) return Promise.resolve(makeEvent('places.add.url', 'error', 500))
        return Promise.resolve(null)
      })

      const result = await handleSlashCommand('/review', 'reply-token', mockEnv, 'PM_USER')
      expect(result).toEqual({ type: 'replied' })
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('places.search')
      expect(sentText).toContain('places.add.url')
      expect(sentText).toContain('success')
      expect(sentText).toContain('error')
      expect(sentText).toContain('ms')
    })

    it('truncates at 4500 characters', async () => {
      // Populate 100 events to force large output
      const ulids = Array.from({ length: 100 }, (_, i) => `01JXZ000000000000000000${i.toString().padStart(3, '0')}`)
      mockKv.get.mockImplementation((key: string) => {
        if (key === 'events:recent') return Promise.resolve(JSON.stringify(ulids))
        for (const u of ulids) {
          if (key === `event:${u}`) return Promise.resolve(makeEvent('places.intent_classify', 'success', 50))
        }
        return Promise.resolve(null)
      })

      await handleSlashCommand('/review', 'reply-token', mockEnv, 'PM_USER')
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText.length).toBeLessThanOrEqual(4500 + 10) // small margin for truncation suffix
    })

    it('includes p95 and avg duration in summary', async () => {
      const ulid = '01JXZ0000000000000000000AA'
      mockKv.get.mockImplementation((key: string) => {
        if (key === 'events:recent') return Promise.resolve(JSON.stringify([ulid]))
        if (key === `event:${ulid}`) return Promise.resolve(makeEvent('places.search', 'success', 350))
        return Promise.resolve(null)
      })

      await handleSlashCommand('/review', 'reply-token', mockEnv, 'PM_USER')
      const sentText = (mockSendReply.mock.calls[0][1][0] as { text: string }).text
      expect(sentText).toContain('350ms')
    })
  })
})
