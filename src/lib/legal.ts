/**
 * The version of MiGallery's terms (the /cgu page) in force: ONE value, read by the page (its
 * "last updated" line) and by the server when it records a consent (`face_consents.version`).
 * Change it - and only it - when the terms change in substance; a member's consent row keeps the
 * version they agreed to.
 */
export const TERMS_VERSION = '2026-10-31';

/** The version recorded for a consent that predates the consent table. */
export const LEGACY_CONSENT_VERSION = 'legacy';
