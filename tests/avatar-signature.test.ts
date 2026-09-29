/**
 * The signed avatar URL is computed on TWO sides that share no code: MiConnect's `avatar` property
 * mapping (Python, `hmac` + `base64.urlsafe_b64encode(...).rstrip("=")`) and this server (Node,
 * `base64url`). A difference in encoding - padding, alphabet, the bytes signed - would typecheck,
 * pass every other test here, and refuse every avatar in MinoWiki and Archives. So the reference
 * vector below was produced by the PYTHON expression, not by the function under test.
 *
 * Server-free: the functions take the key as a parameter and never read `env`.
 */

import { describe, it, expect } from 'vitest';
import { computeAvatarSignature, isAvatarSignatureValid } from '$lib/server/avatar-signature';

const KEY = 'test-signing-key';
const ID_USER = '4f1c9e0b2a7d';
/** python -c "import hmac,hashlib,base64;print(base64.urlsafe_b64encode(hmac.new(b'test-signing-key',b'4f1c9e0b2a7d',hashlib.sha256).digest()).rstrip(b'=').decode())" */
const PYTHON_SIG = 'FTH2VTJxXci8uziCscEytZs35VPJFXj6OXogzdU-KVE';

describe('avatar signature', () => {
  it('matches the value MiConnect computes in Python', () => {
    expect(computeAvatarSignature(KEY, ID_USER)).toBe(PYTHON_SIG);
  });

  it('accepts the signature of the requested user', () => {
    expect(isAvatarSignatureValid(KEY, ID_USER, PYTHON_SIG)).toBe(true);
  });

  it("refuses another user's signature, so a URL opens one avatar only", () => {
    const other = computeAvatarSignature(KEY, 'someone-else');
    expect(isAvatarSignatureValid(KEY, ID_USER, other)).toBe(false);
  });

  it('refuses a signature made with another key', () => {
    expect(isAvatarSignatureValid(KEY, ID_USER, computeAvatarSignature('other-key', ID_USER))).toBe(
      false
    );
  });

  it('refuses a truncated or padded signature', () => {
    expect(isAvatarSignatureValid(KEY, ID_USER, PYTHON_SIG.slice(0, -1))).toBe(false);
    expect(isAvatarSignatureValid(KEY, ID_USER, `${PYTHON_SIG}=`)).toBe(false);
  });

  it('refuses everything when no key is configured', () => {
    expect(isAvatarSignatureValid('', ID_USER, computeAvatarSignature('', ID_USER))).toBe(false);
  });
});
