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

function signRs256(privateKeyPem: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKeyPem, 'base64url');
  return `${header}.${payload}.${sig}`;
}

export function createAssertion(creds: Credentials, audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signRs256(creds.privateKeyPem, {
    iss: creds.clientId, sub: creds.clientId, aud: audience, iat: now, exp: now + 300, jti: randomUUID(),
  });
}

/** Enrolment assertion (spec REGISTRATION 3–6): embeds the server-issued
 *  invitation JWT and is signed with the client's PRIVATE key. Sent to
 *  POST /v1/auth/register together with the matching PUBLIC key. */
export function createEnrolmentAssertion(creds: Credentials, invitationJwt: string, audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signRs256(creds.privateKeyPem, {
    iss: creds.clientId, sub: creds.clientId, aud: audience,
    invitation: invitationJwt,
    iat: now, exp: now + 300, jti: randomUUID(),
  });
}

/** Authentication assertion (spec AUTH C): iss/sub carry cantica_user_id
 *  (enterprise id or account email). Exchanged at POST /v1/auth/assert for a
 *  short-lived access token. */
export function createAuthAssertion(privateKeyPem: string, canticaUserId: string, audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signRs256(privateKeyPem, {
    iss: canticaUserId, sub: canticaUserId, aud: audience, iat: now, exp: now + 300, jti: randomUUID(),
  });
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
