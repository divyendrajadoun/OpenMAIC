/**
 * Password hashing with Node's built-in scrypt: no new dependency, and the
 * parameters are stored in the hash so they can be raised later without
 * invalidating existing accounts.
 *
 * Format: `scrypt$<N>$<salt b64url>$<hash b64url>`.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const KEY_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function scryptOptions(n: number) {
  return { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, scryptOptions(SCRYPT_N));
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Whether `password` matches `stored`; a malformed `stored` never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
  const salt = Buffer.from(parts[2]!, 'base64url');
  const expected = Buffer.from(parts[3]!, 'base64url');
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, KEY_LENGTH, scryptOptions(n));
  return timingSafeEqual(actual, expected);
}

/**
 * A password a teacher can read out or print for a student: 10 characters
 * from an alphabet without look-alikes (no 0/O, 1/l/I).
 */
export function generateReadablePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
