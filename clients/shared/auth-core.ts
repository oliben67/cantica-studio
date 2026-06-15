import { createPrivateKey, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

export interface Credentials {
  clientId: string;
  privateKeyPem: string;
}

export function generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey as string, publicKeyPem: publicKey as string };
}

export function publicKeyFromPrivate(privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return key.export({ type: 'spki', format: 'pem' }) as string;
}

export function createAssertion(creds: Credentials, audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: creds.clientId, sub: creds.clientId, aud: audience, iat: now, exp: now + 300, jti: randomUUID() }),
  ).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(creds.privateKeyPem, 'base64url');
  return `${header}.${payload}.${sig}`;
}

export function makeCachedAssertion(creds: Credentials, audience: string): () => string {
  let cached = '';
  let cachedAt = 0;
  return () => {
    const now = Date.now();
    if (cached && now - cachedAt < 4 * 60 * 1000) return cached;
    cached = createAssertion(creds, audience);
    cachedAt = now;
    return cached;
  };
}
