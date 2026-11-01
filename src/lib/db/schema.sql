-- Schéma de la base de données MiGallery

CREATE TABLE IF NOT EXISTS users (
    id_user TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    photos_id TEXT,
    -- photos_asset_id: Immich asset id backing the chosen profile face. MiGallery
    -- generates its own square crop from it (see /api/faces), instead of Immich's
    -- tightly hard-coded person thumbnail. NULL = fall back to Immich's crop.
    photos_asset_id TEXT,
    -- role: 'admin' | 'mitviste' | 'user'
    role TEXT DEFAULT 'user',
    -- promo: e.g. 2024
    promo INTEGER,
    -- formation: e.g. 'InfoCom', 'DevOps', etc.
    formation TEXT,
    -- locale: preferred UI language ('fr' | 'en'). NULL = no explicit choice
    -- (falls back to the PARAGLIDE_LOCALE cookie, then the base locale).
    locale TEXT
);

-- No example users inserted by default. If you want to seed test users,
-- add them explicitly in your deployment scripts or a separate seed file.

-- Albums table: stores album metadata and visibility
-- Use Immich UUID as the canonical primary key (id)
CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT,
    location TEXT,
    -- visibility: 'private' | 'authenticated' | 'unlisted'
    visibility TEXT NOT NULL DEFAULT 'authenticated',
    -- visible: whether to show the album in public listings (1 = show, 0 = hide)
    visible INTEGER NOT NULL DEFAULT 1,
    -- cover_asset_id: the asset whose square thumbnail is this album's cover.
    -- Persisted so the gallery never has to ask the media backend "which asset
    -- is the cover?" on every page load, and so the on-disk cover file can be
    -- pruned when it stops being referenced. NULL = not resolved yet.
    cover_asset_id TEXT,
    -- cover_asset_type: 'IMAGE' | 'VIDEO', kept only to badge video covers.
    cover_asset_type TEXT
);

-- Unified album permissions: the single source of truth for album access.
-- kind: 'user' | 'tag' | 'formation' | 'promo'. value holds the id/tag/formation/
-- promo (promo stored as TEXT). Historically backfilled once from four legacy
-- album_*_permissions tables (user/tag/formation/promo); those tables were dropped
-- by the database.ts migration at PRAGMA user_version 2 (WP-3a).
CREATE TABLE IF NOT EXISTS album_permissions (
    album_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (album_id, kind, value),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
);

-- User favorites: stores favorite photos per user (not shared with Immich)
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, asset_id),
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);

-- Photo access permissions: allows a user to grant specific people access to their "Mes photos" page
-- RGPD compliant: explicit consent to share biometric-linked photos with specific users only
CREATE TABLE IF NOT EXISTS photo_access_permissions (
    owner_id TEXT NOT NULL,           -- The user who grants access (owner of the photos)
    authorized_id TEXT NOT NULL,      -- The user who is granted access
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_id, authorized_id),
    FOREIGN KEY(owner_id) REFERENCES users(id_user) ON DELETE CASCADE,
    FOREIGN KEY(authorized_id) REFERENCES users(id_user) ON DELETE CASCADE
);

-- Audit logs: events for admin review (creations, updates, deletions, logins)
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    timestamp TEXT DEFAULT (datetime('now')),
    actor TEXT,
    event_type TEXT,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    ip TEXT
);
-- The 90-day purge and the admin log view both filter on the timestamp.
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);

-- Sessions: the server-side half of the login cookie. The cookie carries an
-- opaque token and NOTHING else, so a session is a row we own: it can be
-- expired, listed and deleted. Deleting the row IS logging out.
--
-- impersonated_id_user is the admin "act as" feature (see /admin/login-as). It
-- lives here rather than in a second cookie so it cannot outlive the session
-- that authorised it, and so the real account behind an impersonation is always
-- known - which is what makes stopping one safe to authorise.
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    id_user TEXT NOT NULL,
    impersonated_id_user TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(id_user) REFERENCES users(id_user) ON DELETE CASCADE,
    FOREIGN KEY(impersonated_id_user) REFERENCES users(id_user) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_id_user ON sessions(id_user);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- API Keys: for external access (e.g. scripts, other apps)
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    scopes TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Avatar link revocations: a random salt per user whose signed avatar links were revoked
-- (src/lib/server/avatar-signature.ts). Keyed by id_user and deliberately NOT a foreign key: the
-- revocation must survive the deletion of the account, or a user recreated at their next sign-in
-- (same id_user) would re-validate every URL ever issued.
CREATE TABLE IF NOT EXISTS avatar_revocations (
    id_user TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    revoked_at INTEGER NOT NULL
);

-- Face erasures: the durable journal of a face withdrawal or an account deletion whose Immich
-- half (removing the person's name and birth date; the anonymous cluster stays) is still owed.
-- The local half (the link, the crops, the grants, the log ids) is done in the request itself;
-- this row is what makes the remote half survive a restart and an Immich outage. It names the
-- Immich person only - never the member - and that id is cleared once the erasure is done (see
-- src/lib/server/face-erasure.ts).
CREATE TABLE IF NOT EXISTS face_erasures (
    id INTEGER PRIMARY KEY,
    person_id TEXT,
    -- reason: 'withdrawal' | 'account_deletion' | 'relink' | 'admin_unlink'
    reason TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_error TEXT,
    done_at INTEGER,
    -- outcome: 'erased' (the name and birth date are gone from Immich) | 'relinked' (the person now belongs to a member: nothing touched) | 'absent' (Immich no
    -- longer had the person)
    outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_face_erasures_pending ON face_erasures(done_at);

-- Face consents: the record that a member agreed to link their face to their account, with when,
-- under which version of the terms (src/lib/legal.ts TERMS_VERSION) and HOW. source:
-- 'selfie' (the member linked a person from their own selfie), 'admin' (an admin linked it for
-- them) or 'legacy' (the link existed before this table: the consent was obtained by another
-- means, the owner keeps that proof, and created_at is the backfill date, NOT the consent date).
-- A withdrawal sets withdrawn_at and keeps the row; an account deletion takes it by cascade.
CREATE TABLE IF NOT EXISTS face_consents (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    version TEXT NOT NULL,
    source TEXT NOT NULL,
    withdrawn_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_face_consents_user ON face_consents(user_id);

-- Face store, option C (docs/wiki/face-matching-option-c.md). Templates are BIOMETRIC, so every
-- vector is sealed (AES-256-GCM, src/lib/server/face-seal.ts) and bound by its authenticated
-- context: a reference to its member AND model (referenceContext), an embedding to its asset, face
-- index and model (embeddingContext) - a ciphertext copied elsewhere fails to open. A member's own
-- references are NOT told apart from one another. `secure_delete`
-- is ON (database.ts) so a deleted row is overwritten, not just unlinked.
--
-- face_references: up to 15 reference embeddings of a consenting member (source: 'selfie' |
-- 'photo' (a face they confirmed) | 'matched' (an `auto` face proven theirs, faces v2) | 'admin'
-- | 'seed', the last written only by the A7 seed). `asset_id`/`face_index` name the stored face a
-- reference was taken from (NULL for a selfie and for the A7 seed's), `taken_at` the capture date
-- of its photo (ms; the selfie's is its enrolment), which renewal reads. The trigger holds the cap
-- at FACE_MAX_REFERENCES (15) per member AND model whoever inserts (a test pins the number against
-- the constant; database.ts replaces an older trigger). An account deletion takes them by cascade.
CREATE TABLE IF NOT EXISTS face_references (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    source TEXT NOT NULL,
    sealed BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    asset_id TEXT,
    face_index INTEGER,
    taken_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_face_references_user ON face_references(user_id);
CREATE TRIGGER IF NOT EXISTS trg_face_references_cap
BEFORE INSERT ON face_references
WHEN (SELECT COUNT(*) FROM face_references WHERE user_id = NEW.user_id AND model = NEW.model) >= 15
BEGIN
    SELECT RAISE(ABORT, 'face_references: at most 15 per member and model');
END;

-- face_negatives (faces v2, owner 2026-11-01): a face a member answered "not me" on, kept sealed
-- like a reference (its own context, so a negative never opens as a reference) for THAT member
-- only: a face nearer one of their negatives than to their nearest reference is not offered to
-- them. At most FACE_MAX_NEGATIVES (30) per member and model (the trigger; the code drops the most
-- redundant first). Withdrawal deletes them with the references; an account deletion by cascade.
CREATE TABLE IF NOT EXISTS face_negatives (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    face_index INTEGER NOT NULL,
    sealed BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, model, asset_id, face_index),
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_face_negatives_user ON face_negatives(user_id);
CREATE TRIGGER IF NOT EXISTS trg_face_negatives_cap
BEFORE INSERT ON face_negatives
WHEN (SELECT COUNT(*) FROM face_negatives WHERE user_id = NEW.user_id AND model = NEW.model) >= 30
BEGIN
    SELECT RAISE(ABORT, 'face_negatives: at most 30 per member and model');
END;

-- face_reference_selection (faces v2): which version of the reference selection last chose a
-- member's references (FACE_REFERENCE_SELECTION_VERSION). A member below it is re-selected once, in
-- the background (face-reference-upgrade.ts); the row is written in the same transaction as the
-- new references, so a crash resumes and a done member is never redone. Withdrawal deletes it.
CREATE TABLE IF NOT EXISTS face_reference_selection (
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    version INTEGER NOT NULL,
    selected_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, model),
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);

-- face_embeddings (every detected face, non-members included) is NOT in this file: it lives in
-- data/faces.db (src/lib/db/face-database.ts), which no backup copies, because the faces are
-- recomputed from the photographs. Only what concerns consenting members stays here.
--
-- face_matches (lot A4): which member a stored face was given to, by
-- src/lib/server/face-engine.ts and nothing else. A face has at most ONE holder (a row not
-- 'rejected', the partial unique index); 'rejected' rows only remember who said "not me", so
-- the face is never offered to them again. `band` is the matcher's ('auto' shows without a
-- question, 'suggested' waits for the member), `state` the member's answer. The face itself
-- (asset_id, face_index, model) is a key of faces.db: no foreign key can cross the two files, so
-- face-engine.ts deletes the rows of a face it deletes. An account deletion takes them by cascade.
CREATE TABLE IF NOT EXISTS face_matches (
    asset_id TEXT NOT NULL,
    face_index INTEGER NOT NULL,
    model TEXT NOT NULL,
    user_id TEXT NOT NULL,
    distance REAL NOT NULL,
    runner_up REAL,
    band TEXT NOT NULL CHECK (band IN ('auto', 'suggested')),
    state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'rejected')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    PRIMARY KEY(asset_id, face_index, model, user_id),
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_face_matches_holder
    ON face_matches(asset_id, face_index, model) WHERE state != 'rejected';
CREATE INDEX IF NOT EXISTS idx_face_matches_user ON face_matches(user_id, state, band);
