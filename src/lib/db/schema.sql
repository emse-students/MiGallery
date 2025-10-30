-- Schéma de la base de données MiGallery

CREATE TABLE IF NOT EXISTS users (
    id_user TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    prenom TEXT NOT NULL,
    nom TEXT NOT NULL,
    id_photos TEXT,
    first_login INTEGER DEFAULT 1
);

-- Insertion de vos données (uniquement si pas déjà présent)
INSERT INTO users (id_user, email, prenom, nom, id_photos, first_login) 
VALUES ('jolan.boudin', 'jolan.boudin@etu.emse.fr', 'Jolan', 'BOUDIN', '031b39ea-7c35-4d52-bc00-46ff0d927afa', 0);
