import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/home-store', () => ({
  getHomeLocation: vi.fn(),
  setHomeLocation: vi.fn().mockResolvedValue(undefined),
  setCurrentOrigin: vi.fn().mockResolvedValue(undefined),
  consumeHomeUpdatePending: vi.fn(),
}))

import { runFlowSetup } from '../../src/capabilities/places/flow-setup'
import { sendReply } from '../../src/integrations/line'
import { getHomeLocation, setHomeLocation, setCurrentOrigin, consumeHomeUpdatePending } from '../../src/capabilities/places/home-store'

const mockReply = vi.mocked(sendReply)
const mockGetHome = vi.mocked(getHomeLocation)
const mockSetHome = vi.mocked(setHomeLocation)
const mockSetOrigin = vi.mocked(setCurrentOrigin)
const mockConsume = vi.mocked(consumeHomeUpdatePending)

const mockEnv = {} as unknown as Env
const USER = 'U001'
const LOCATION = { lat: 25.05, lng: 121.52, address: '台北市大安區仁愛路四段' }

beforeEach(() => vi.clearAllMocks())

describe('runFlowSetup', () => {
  it('sets home when no home exists yet (first-time setup)', async () => {
    mockConsume.mockResolvedValueOnce(false)
    mockGetHome.mockResolvedValueOnce(null)
    await runFlowSetup(LOCATION, 'reply-token', mockEnv, USER)
    expect(mockSetHome).toHaveBeenCalledWith(mockEnv, USER, 25.05, 121.52, LOCATION.address)
    expect(mockSetOrigin).not.toHaveBeenCalled()
    const [, messages] = mockReply.mock.calls[0]
    expect((messages[0] as { text: string }).text).toContain(LOCATION.address)
  })

  it('sets current_origin when home already exists and no pending update (2h override)', async () => {
    mockConsume.mockResolvedValueOnce(false)
    mockGetHome.mockResolvedValueOnce({ lat: 25.05, lng: 121.52, address: '台北市大安區' })
    await runFlowSetup(LOCATION, 'reply-token', mockEnv, USER)
    expect(mockSetOrigin).toHaveBeenCalledWith(mockEnv, USER, 25.05, 121.52)
    expect(mockSetHome).not.toHaveBeenCalled()
    const [, messages] = mockReply.mock.calls[0]
    expect((messages[0] as { text: string }).text).toContain('2 小時')
  })

  it('updates home when home_update_pending flag is set', async () => {
    mockConsume.mockResolvedValueOnce(true)
    await runFlowSetup(LOCATION, 'reply-token', mockEnv, USER)
    expect(mockSetHome).toHaveBeenCalledWith(mockEnv, USER, 25.05, 121.52, LOCATION.address)
    expect(mockSetOrigin).not.toHaveBeenCalled()
    expect(mockGetHome).not.toHaveBeenCalled()
    const [, messages] = mockReply.mock.calls[0]
    expect((messages[0] as { text: string }).text).toContain('已更新為')
    expect((messages[0] as { text: string }).text).toContain(LOCATION.address)
  })

  it('falls back to current_origin when flag is expired (consume returns false, home exists)', async () => {
    mockConsume.mockResolvedValueOnce(false)
    mockGetHome.mockResolvedValueOnce({ lat: 25.05, lng: 121.52, address: '台北市大安區' })
    await runFlowSetup(LOCATION, 'reply-token', mockEnv, USER)
    expect(mockSetOrigin).toHaveBeenCalledWith(mockEnv, USER, 25.05, 121.52)
    expect(mockSetHome).not.toHaveBeenCalled()
  })
})
