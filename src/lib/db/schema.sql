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

-- Insertion de vos données (uniquement si pas déjà présent)
-- Insère un utilisateur d'exemple uniquement s'il n'existe pas déjà
INSERT INTO users (id_user, email, prenom, nom, id_photos, first_login)
SELECT 'jolan.boudin', 'jolan.boudin@etu.emse.fr', 'Jolan', 'BOUDIN', '031b39ea-7c35-4d52-bc00-46ff0d927afa', 0
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id_user = 'jolan.boudin');

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
