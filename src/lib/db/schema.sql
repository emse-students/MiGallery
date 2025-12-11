-- Schéma de la base de données MiGallery

CREATE TABLE IF NOT EXISTS users (
    id_user TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    prenom TEXT NOT NULL,
    nom TEXT NOT NULL,
    id_photos TEXT,
    first_login INTEGER DEFAULT 1,
    -- role: 'admin' | 'mitviste' | 'user'
    role TEXT DEFAULT 'user',
    -- promo_year: e.g. 2024
    promo_year INTEGER
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
    visible INTEGER NOT NULL DEFAULT 1
);

-- Specific user permissions for an album (grants access to listed users)
CREATE TABLE IF NOT EXISTS album_user_permissions (
    album_id TEXT NOT NULL,
    id_user TEXT NOT NULL,
    PRIMARY KEY (album_id, id_user),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
);

-- Tag-based permissions (e.g. 'Promo 2024')
CREATE TABLE IF NOT EXISTS album_tag_permissions (
    album_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (album_id, tag),
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
