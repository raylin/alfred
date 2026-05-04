import type { MiddlewareHandler } from 'hono'
import type { Env } from './env'
import type { Variables } from './variables'

async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const bytes = new Uint8Array(sig)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

export const lineSignatureMiddleware: MiddlewareHandler<{
  Bindings: Env
  Variables: Variables
}> = async (c, next) => {
  const signature = c.req.header('x-line-signature')
  if (!signature) return c.text('Unauthorized', 401)

  const rawBody = await c.req.text()
  const expected = await hmacSha256Base64(c.env.LINE_CHANNEL_SECRET, rawBody)

  if (expected !== signature) {
    console.error('[line-signature] verification failed')
    return c.text('Unauthorized', 401)
  }

  c.set('rawBody', rawBody)
  await next()
}
