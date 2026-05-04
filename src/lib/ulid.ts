const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateUlid(): string {
  const timeChars = new Array<string>(10)
  let ms = Date.now()
  for (let i = 9; i >= 0; i--) {
    timeChars[i] = ENCODING[ms % 32]!
    ms = Math.floor(ms / 32)
  }
  // 256 = 8 × 32, so b % 32 is uniform across all 256 byte values
  const rand = crypto.getRandomValues(new Uint8Array(16))
  const randChars = Array.from(rand, b => ENCODING[b % 32]!)
  return timeChars.join('') + randChars.join('')
}
