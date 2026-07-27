// src/lib/jwt.ts

const encoder = new TextEncoder();

function base64url(arr: Uint8Array): string {
  const binString = Array.from(arr, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binString)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str: string): Uint8Array {
  let cleaned = str.replace(/-/g, '+').replace(/_/g, '/');
  while (cleaned.length % 4) {
    cleaned += '=';
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function signJWT(payload: any, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const headerStr = base64url(encoder.encode(JSON.stringify(header)));
  const payloadStr = base64url(encoder.encode(JSON.stringify(payload)));
  const data = encoder.encode(`${headerStr}.${payloadStr}`);
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuf = await crypto.subtle.sign('HMAC', key, data as any);
  const signatureStr = base64url(new Uint8Array(signatureBuf));
  
  return `${headerStr}.${payloadStr}.${signatureStr}`;
}

export async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerStr, payloadStr, signatureStr] = parts;
    const data = encoder.encode(`${headerStr}.${payloadStr}`);
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret) as any,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = base64urlDecode(signatureStr);
    const isValid = await crypto.subtle.verify('HMAC', key, signature as any, data as any);
    
    if (!isValid) return null;
    
    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadStr));
    const payload = JSON.parse(payloadJson);
    
    // Check expiration if exp is present in payload (millisecond-based)
    if (payload.exp && Date.now() >= payload.exp) {
      return null;
    }
    
    return payload;
  } catch (err) {
    return null;
  }
}
