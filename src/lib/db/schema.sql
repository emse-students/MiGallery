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
    -- first_login: 1 = first time (promo modal shown), 0 = already completed
    first_login INTEGER DEFAULT 1,
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
