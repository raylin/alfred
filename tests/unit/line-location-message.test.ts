import { describe, it, expect } from 'vitest'
import { isLocationMessage, isTextMessage, isImageMessage } from '../../src/integrations/line'

const locationMsg = {
  type: 'location' as const,
  id: 'msg-1',
  title: '台北車站',
  address: '台北市中正區北平西路3號',
  latitude: 25.0478,
  longitude: 121.5170,
}

describe('isLocationMessage', () => {
  it('returns true for a location message', () => {
    expect(isLocationMessage(locationMsg)).toBe(true)
  })

  it('returns false for a text message', () => {
    expect(isLocationMessage({ type: 'text', id: '1', text: 'hello' })).toBe(false)
  })

  it('returns false for an image message', () => {
    expect(isLocationMessage({ type: 'image', id: '1' })).toBe(false)
  })

  it('does not overlap with isTextMessage or isImageMessage', () => {
    expect(isTextMessage(locationMsg)).toBe(false)
    expect(isImageMessage(locationMsg)).toBe(false)
  })
})
