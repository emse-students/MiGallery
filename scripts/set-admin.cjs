// Script pour donner le rôle admin à un utilisateur
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/migallery.db');

console.log('Connexion à la base de données:', DB_PATH);

const db = new Database(DB_PATH);

// Récupérer l'ID utilisateur depuis les arguments
const userId = process.argv[2] || 'jolan.boudin';

console.log(`Attribution du rôle admin à l'utilisateur: ${userId}`);

try {
  // Vérifier si l'utilisateur existe
  const user = db.prepare('SELECT * FROM users WHERE id_user = ?').get(userId);
  
  if (!user) {
    console.error(`❌ Utilisateur "${userId}" non trouvé dans la base de données`);
    process.exit(1);
  }
  
  console.log('Utilisateur trouvé:', user);
  
  // Mettre à jour le rôle
  const stmt = db.prepare('UPDATE users SET role = ? WHERE id_user = ?');
  const result = stmt.run('admin', userId);
  
  if (result.changes > 0) {
    console.log(`✅ Rôle admin attribué avec succès à ${userId}`);
    
    // Vérifier le résultat
    const updated = db.prepare('SELECT * FROM users WHERE id_user = ?').get(userId);
    console.log('Utilisateur mis à jour:', updated);
  } else {
    console.error('❌ Erreur lors de la mise à jour');
  }
} catch (error) {
  console.error('❌ Erreur:', error.message);
  process.exit(1);
} finally {
  db.close();
}
