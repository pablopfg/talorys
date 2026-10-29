import { z } from "zod";

/**
 * Passkeys (WebAuthn) as a second sign-in step, next to the authenticator app: after the password,
 * the browser asks the phone, computer or security key to confirm. They need two-step sign-in on,
 * so the recovery codes stay the way back in when every passkey is lost.
 */
export const MAX_PASSKEYS = 10;
export const PASSKEY_NAME_MAX = 60;
/** How long the browser has to create or use a passkey once asked. */
export const PASSKEY_TIMEOUT_MS = 2 * 60_000;

export interface PasskeyInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  /** Synced by its provider (iCloud Keychain, Google Password Manager, a password manager). */
  synced: boolean;
  /**
   * Made for this address. A passkey belongs to the domain it was made on: one made on the
   * workers.dev address doesn't work on your own domain, and the other way round.
   */
  usable_here: boolean;
}

const b64url = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9_-]*$/, "Invalid encoding.");

const credentialBase = {
  id: b64url(1400),
  rawId: b64url(1400),
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
};

/** What the browser returns from navigator.credentials.create, as JSON. The server checks every field. */
export const passkeyRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(PASSKEY_NAME_MAX),
  response: z.object({
    ...credentialBase,
    response: z.object({
      clientDataJSON: b64url(4096),
      attestationObject: b64url(16_384),
      transports: z.array(z.string().max(32)).max(10).optional(),
    }),
  }),
});

/** What the browser returns from navigator.credentials.get, as JSON. */
export const passkeyAssertionSchema = z.object({
  response: z.object({
    ...credentialBase,
    response: z.object({
      clientDataJSON: b64url(4096),
      authenticatorData: b64url(4096),
      signature: b64url(2048),
      userHandle: b64url(256).optional(),
    }),
  }),
});

export const passkeyRenameSchema = z.object({ name: z.string().trim().min(1).max(PASSKEY_NAME_MAX) });
