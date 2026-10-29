/**
 * A software passkey for tests: an ES256 (P-256) key that answers WebAuthn requests the way a
 * browser and authenticator would, with "none" attestation.
 */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

/** Just enough CBOR for an attestation object: maps, byte and text strings, integers. */
function cbor(value: unknown): Uint8Array {
  const head = (major: number, n: number) => {
    if (n < 24) return new Uint8Array([(major << 5) | n]);
    if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
    return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") return concat(head(3, utf8(value).length), utf8(value));
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (value instanceof Map) return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  throw new Error("unsupported");
}

/** ECDSA from WebCrypto is r||s; WebAuthn wants DER. */
function der(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export interface SoftPasskey {
  id: string;
  counter: number;
  register(options: { challenge: string; rp: { id: string } }, origin: string): Promise<unknown>;
  assert(options: { challenge: string; rpId?: string }, origin: string, tweak?: { rpId?: string; counter?: number }): Promise<unknown>;
}

export async function softPasskey(): Promise<SoftPasskey> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  const counterBytes = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  const key: SoftPasskey = {
    id: b64url(rawId),
    counter: 0,
    async register(options, origin) {
      const clientData = utf8(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
      const cose = cbor(
        new Map<number, unknown>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, fromB64url(jwk.x!)],
          [-3, fromB64url(jwk.y!)],
        ]),
      );
      const authData = concat(
        await sha256(utf8(options.rp.id)),
        new Uint8Array([0x01 | 0x04 | 0x40]),
        counterBytes(0),
        new Uint8Array(16),
        new Uint8Array([0, rawId.length]),
        rawId,
        cose,
      );
      const attestation = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id: key.id,
        rawId: key.id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ["internal"] },
      };
    },
    async assert(options, origin, tweak = {}) {
      key.counter = tweak.counter ?? key.counter + 1;
      const clientData = utf8(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
      const authData = concat(await sha256(utf8(tweak.rpId ?? options.rpId!)), new Uint8Array([0x01 | 0x04]), counterBytes(key.counter));
      const signed = concat(authData, await sha256(clientData));
      const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      return {
        id: key.id,
        rawId: key.id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(der(signature)) },
      };
    },
  };
  return key;
}
