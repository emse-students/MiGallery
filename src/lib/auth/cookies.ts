import crypto from 'crypto';

function base64UrlEncode(buf: Buffer) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str: string) {
  // restore padding
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  // add padding
  const pad = 4 - (str.length % 4);
  if (pad !== 4) str += '='.repeat(pad);
  return Buffer.from(str, 'base64');
}

export function signId(id: string) {
  const secret = process.env.COOKIE_SECRET || '';
  const h = crypto.createHmac('sha256', secret).update(id).digest();
  return `${id}.${base64UrlEncode(h)}`;
}

export function verifySigned(signed: string): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const id = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const secret = process.env.COOKIE_SECRET || '';
  const expected = crypto.createHmac('sha256', secret).update(id).digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(sig);
  } catch (e) {
    return null;
  }
  if (provided.length !== expected.length) return null;
  try {
    if (crypto.timingSafeEqual(provided, expected)) return id;
  } catch (e) {
    return null;
  }
  return null;
}
