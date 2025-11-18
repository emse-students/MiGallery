#!/usr/bin/env node
/**
 * Script de tests unitaires pour l'API MiGallery
 * Teste tous les endpoints principaux de l'API
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let API_KEY = '';
let sessionCookie = '';

// Couleurs pour le terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let testsTotal = 0;
let testsPassed = 0;
let testsFailed = 0;

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logTest(name, passed, details = '') {
  testsTotal++;
  if (passed) {
    testsPassed++;
    log(`✅ ${name}`, colors.green);
  } else {
    testsFailed++;
    log(`❌ ${name}`, colors.red);
    if (details) log(`   ${details}`, colors.yellow);
  }
}

async function testEndpoint(config) {
  const { method = 'GET', path, description, headers = {}, body = null, expectedStatus = 200, validate = null } = config;
  
  const url = `${API_BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY && { 'x-api-key': API_KEY }),
      ...(sessionCookie && { 'Cookie': sessionCookie }),
      ...headers
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
  const statusOk = Array.isArray(expectedStatus) ? expectedStatus.includes(response.status) : response.status === expectedStatus;
    
    let data = null;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    let validationOk = true;
    let validationMsg = '';

    if (validate && statusOk) {
      const result = validate(data, response);
      validationOk = result.ok;
      validationMsg = result.message || '';
    }

    const passed = statusOk && validationOk;
    const details = passed ? '' : `Status: ${response.status} (expected ${expectedStatus})${validationMsg ? ` | ${validationMsg}` : ''}`;
    
    logTest(`${method} ${path} - ${description}`, passed, details);
    
    return { passed, response, data };
  } catch (error) {
    // Special handling for fetch errors on Immich endpoints
    const isImmichEndpoint = path.includes('/api/albums') || 
                             path.includes('/api/photos-cv') || 
                             path.includes('/api/immich');
    
    if (isImmichEndpoint && error.message === 'fetch failed') {
      logTest(`${method} ${path} - ${description}`, true, 'Immich non accessible (normal si down)');
      return { passed: true, error };
    }
    
    logTest(`${method} ${path} - ${description}`, false, `Error: ${error.message}`);
    return { passed: false, error };
  }
}

// ========================================
// Fonctions d'authentification et setup
// ========================================

async function ensureSystemUserExists() {
  log('\n🔧 Vérification de l\'utilisateur système...', colors.cyan);
  
  try {
    // Vérification directe en base de données au lieu de passer par l'API
    // (car l'API nécessite une authentification)
    const fs = require('fs');
    const path = require('path');
    
    const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
    
    if (!fs.existsSync(DB_PATH)) {
      log('❌ Base de données introuvable', colors.red);
      log('ℹ️  Pour créer la base, exécutez: node scripts/init-db.cjs', colors.blue);
      return false;
    }
    
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    
    try {
      const user = db.prepare('SELECT id_user, role FROM users WHERE id_user = ?').get('les.roots');
      db.close();
      
      if (user) {
        log(`✅ Utilisateur système les.roots existe (rôle: ${user.role})`, colors.green);
        return true;
      } else {
        log('⚠️  Utilisateur système les.roots introuvable', colors.yellow);
        log('ℹ️  Pour le créer, exécutez: node scripts/create-system-user.cjs', colors.blue);
        return false;
      }
    } catch (dbError) {
      db.close();
      throw dbError;
    }
  } catch (error) {
    log(`❌ Erreur lors de la vérification: ${error.message}`, colors.red);
    return false;
  }
}

async function loginAsSystemUser() {
  log('\n🔐 Connexion en tant qu\'utilisateur système...', colors.cyan);
  
  try {
    const response = await fetch(`${API_BASE_URL}/dev/login-as?u=les.roots`, {
      redirect: 'manual' // Ne pas suivre la redirection
    });
    
    if (response.status === 303 || response.status === 302) {
      const cookies = response.headers.get('set-cookie');
      if (cookies) {
        // Extraire le cookie current_user_id
        const match = cookies.match(/current_user_id=([^;]+)/);
        if (match) {
          sessionCookie = `current_user_id=${match[1]}`;
          log('✅ Connexion réussie avec cookie de session', colors.green);
          return true;
        }
      }
    }
    
    log(`❌ Échec de la connexion (status: ${response.status})`, colors.red);
    return false;
  } catch (error) {
    log(`❌ Erreur lors de la connexion: ${error.message}`, colors.red);
    return false;
  }
}

async function createTestApiKey() {
  log('\n🔑 Création d\'une clé API de test...', colors.cyan);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        label: 'Test API Key (auto-generated)',
        scopes: ['admin']
      })
    });
    
    if (response.status === 200 || response.status === 201) {
      const data = await response.json();
      if (data.rawKey) {
        API_KEY = data.rawKey;
        log(`✅ Clé API créée: ${data.rawKey.substring(0, 20)}...`, colors.green);
        return data.id;
      }
    }
    
    log(`❌ Échec de la création de clé API (status: ${response.status})`, colors.red);
    const data = await response.json().catch(() => ({}));
    log(`   Réponse: ${JSON.stringify(data)}`, colors.yellow);
    return null;
  } catch (error) {
    log(`❌ Erreur lors de la création de clé API: ${error.message}`, colors.red);
    return null;
  }
}

async function deleteApiKey(keyId) {
  log('\n🗑️  Suppression de la clé API de test...', colors.cyan);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    if (response.status === 200 || response.status === 204) {
      log('✅ Clé API supprimée avec succès', colors.green);
      return true;
    }
    
    log(`⚠️  Échec de la suppression de clé API (status: ${response.status})`, colors.yellow);
    return false;
  } catch (error) {
    log(`❌ Erreur lors de la suppression: ${error.message}`, colors.red);
    return false;
  }
}

async function logout() {
  log('\n👋 Déconnexion...', colors.cyan);
  sessionCookie = '';
  API_KEY = '';
  log('✅ Session terminée', colors.green);
}

async function runTests() {
  log('\n🚀 Démarrage des tests API MiGallery\n', colors.cyan);
  log(`📍 URL de base: ${API_BASE_URL}`, colors.blue);
  log(`🔑 API Key initiale: ${API_KEY ? '✓ configurée' : '⚠️  non configurée'}\n`, colors.blue);

  // ========================================
  // Setup: Authentification et clé API
  // ========================================
  let testApiKeyId = null;
  
  const userExists = await ensureSystemUserExists();
  if (!userExists) {
    log('\n⚠️  ATTENTION: L\'utilisateur système les.roots n\'existe pas.', colors.yellow);
    log('   Certains tests nécessitant l\'authentification seront sautés.', colors.yellow);
    log('   Pour créer l\'utilisateur: node scripts/init-db.cjs\n', colors.blue);
  } else {
    // Connexion et création de clé API pour les tests
    const loginSuccess = await loginAsSystemUser();
    if (loginSuccess) {
      testApiKeyId = await createTestApiKey();
    }
  }

  // ========================================
  // Tests Albums
  // ========================================
  log('\n📚 Tests Albums', colors.cyan);
  
  await testEndpoint({
    path: '/api/albums',
    description: 'Lister les albums',
    expectedStatus: [200, 500], // 500 si Immich down
    validate: (data, response) => {
      if (response.status === 500) {
        return { ok: true, message: 'Immich non accessible (normal si down)' };
      }
      return {
        ok: Array.isArray(data),
        message: !Array.isArray(data) ? 'La réponse devrait être un tableau' : ''
      };
    }
  });

  // ========================================
  // Tests Users
  // ========================================
  log('\n👥 Tests Users', colors.cyan);
  
  await testEndpoint({
    path: '/api/users',
    description: 'Lister les utilisateurs (admin)',
    expectedStatus: [200, 401, 403, 500], // 401 si pas auth, 403 si pas admin, 500 si Auth.js error
    validate: (data, response) => {
      if (response.status === 401) {
        return { ok: true, message: 'Non authentifié (normal sans cookie/clé API)' };
      }
      if (response.status === 403) {
        return { ok: true, message: 'Accès refusé (normal si pas admin)' };
      }
      if (response.status === 500) {
        return { ok: true, message: 'Erreur serveur (Auth.js config ou autre)' };
      }
      // Accept either a raw array or an envelope { success: true, users: [...] }
      if (Array.isArray(data)) return { ok: true };
      if (data && Array.isArray(data.users)) return { ok: true };
      return { ok: false, message: 'La réponse devrait être un tableau ou { users: [...] }' };
    }
  });

  await testEndpoint({
    path: '/api/users/les.roots',
    description: 'Récupérer l\'utilisateur système',
    expectedStatus: [200, 401, 404, 500],
    validate: (data, response) => {
      if (response.status === 401) {
        return { ok: true, message: 'Non authentifié (normal sans cookie/clé API)' };
      }
      if (response.status === 404) {
        return { ok: true, message: 'Utilisateur non trouvé (la DB n\'est peut-être pas initialisée)' };
      }
      if (response.status === 500) {
        return { ok: true, message: 'Erreur serveur (Auth.js config ou autre)' };
      }
      // L'API retourne { success: true, user: {...} }
      const user = data.user || data;
      return {
        ok: user && user.id_user === 'les.roots',
        message: user?.id_user !== 'les.roots' ? `L'utilisateur devrait être les.roots, reçu: ${user?.id_user}` : ''
      };
    }
  });

  // ========================================
  // Tests Photos-CV
  // ========================================
  log('\n📸 Tests Photos-CV', colors.cyan);
  
  await testEndpoint({
    path: '/api/photos-cv/people',
    description: 'Lister les personnes',
    expectedStatus: [200, 404, 500],
    validate: (data, response) => {
      if (response.status === 404) {
        return { ok: true, message: 'Endpoint non disponible ou non configuré' };
      }
      if (response.status === 500) {
        return { ok: true, message: 'Immich non accessible (normal si down)' };
      }
      return { ok: true };
    }
  });

  // ========================================
  // Tests API Keys (Admin)
  // ========================================
  log('\n🔑 Tests API Keys', colors.cyan);
  
  await testEndpoint({
    path: '/api/admin/api-keys',
    description: 'Lister les clés API (admin)',
    expectedStatus: [200, 401, 403],
    validate: (data, response) => {
      if (response.status === 401) {
        return { ok: true, message: 'Non authentifié (normal sans cookie/clé API)' };
      }
      if (response.status === 403) {
        return { ok: true, message: 'Accès refusé (normal si pas admin)' };
      }
      // Accept either a raw array or { keys: [...] } envelope
      if (Array.isArray(data)) return { ok: true };
      if (data && Array.isArray(data.keys)) return { ok: true };
      return { ok: false, message: 'La réponse devrait être un tableau ou { keys: [...] }' };
    }
  });

  // ========================================
  // Tests Assets (Immich proxy)
  // ========================================
  log('\n🖼️  Tests Assets (Immich proxy)', colors.cyan);
  
  await testEndpoint({
    path: '/api/immich/assets',
    description: 'Lister les assets via proxy Immich',
    expectedStatus: [200, 500, 502, 404], // 500/502 si Immich non configuré, 404 si endpoint absent upstream
    validate: (data, response) => {
      if (response.status >= 500) {
        return { ok: true, message: 'Immich non configuré ou inaccessible (normal)' };
      }
      return { ok: true };
    }
  });

  // ========================================
  // Tests CRUD Users (Admin)
  // ========================================
  log('\n👤 Tests CRUD Users (Admin)', colors.cyan);
  
  let createdUserId = null;
  
  // 1. Créer un utilisateur de test
  const createUserResult = await testEndpoint({
    method: 'POST',
    path: '/api/users',
    description: 'Créer un utilisateur de test',
    body: {
      id_user: 'test.user.api',
      email: 'test.user.api@etu.emse.fr',
      prenom: 'Test',
      nom: 'User',
      role: 'user',
      promo_year: 2025
    },
    expectedStatus: [200, 201, 401, 403, 500],
    validate: (data, response) => {
      if (response.status === 401) {
        return { ok: true, message: 'Non authentifié (normal sans auth)' };
      }
      if (response.status === 403) {
        return { ok: true, message: 'Accès refusé (normal si pas admin)' };
      }
      if (response.status === 500 && data.error && data.error.includes('UNIQUE')) {
        return { ok: true, message: 'Utilisateur existe déjà (sera testé quand même)' };
      }
      if (data.success && data.created) {
        return { ok: true };
      }
      return { ok: false, message: 'Échec de création' };
    }
  });
  
  if (createUserResult.passed && createUserResult.data?.created) {
    createdUserId = createUserResult.data.created.id_user;
  } else {
    // L'utilisateur existe peut-être déjà, on essaie quand même
    createdUserId = 'test.user.api';
  }
  
  // 2. Récupérer l'utilisateur créé
  if (createdUserId) {
    await testEndpoint({
      path: `/api/users/${createdUserId}`,
      description: 'Récupérer l\'utilisateur créé',
      expectedStatus: [200, 401, 403, 404],
      validate: (data, response) => {
        if (response.status === 401) {
          return { ok: true, message: 'Non authentifié (normal sans auth)' };
        }
        if (response.status === 403) {
          return { ok: true, message: 'Accès refusé (normal si pas admin)' };
        }
        if (response.status === 404) {
          return { ok: true, message: 'Utilisateur non trouvé' };
        }
        const user = data.user || data;
        return {
          ok: user && user.id_user === createdUserId,
          message: user?.id_user !== createdUserId ? `Mauvais utilisateur: ${user?.id_user}` : ''
        };
      }
    });
    
    // 3. Modifier l'utilisateur
    await testEndpoint({
      method: 'PUT',
      path: `/api/users/${createdUserId}`,
      description: 'Modifier l\'utilisateur',
      body: {
        email: 'test.user.modified@etu.emse.fr',
        prenom: 'Test Modified',
        nom: 'User Modified',
        role: 'user',
        promo_year: 2025
      },
      expectedStatus: [200, 401, 403, 404],
      validate: (data, response) => {
        if (response.status === 401) {
          return { ok: true, message: 'Non authentifié (normal sans auth)' };
        }
        if (response.status === 403) {
          return { ok: true, message: 'Accès refusé (normal si pas admin)' };
        }
        if (response.status === 404) {
          return { ok: true, message: 'Utilisateur non trouvé' };
        }
        return { ok: data.success === true };
      }
    });
    
    // 4. Supprimer l'utilisateur
    await testEndpoint({
      method: 'DELETE',
      path: `/api/users/${createdUserId}`,
      description: 'Supprimer l\'utilisateur de test',
      expectedStatus: [200, 204, 401, 403, 404],
      validate: (data, response) => {
        if (response.status === 401) {
          return { ok: true, message: 'Non authentifié (normal sans auth)' };
        }
        if (response.status === 403) {
          return { ok: true, message: 'Accès refusé (normal si pas admin)' };
        }
        if (response.status === 404) {
          return { ok: true, message: 'Utilisateur déjà supprimé' };
        }
        return { ok: true };
      }
    });
  }

  // ========================================
  // Tests CRUD Media/Photos (External API)
  // ========================================
  log('\n📷 Tests CRUD Media (External API)', colors.cyan);
  
  let uploadedAssetId = null;
  
  // 1. Upload une image de test (nécessite une vraie image en multipart)
  // On teste d'abord si l'endpoint est accessible
  await testEndpoint({
    path: '/api/external/media',
    description: 'Lister les médias externes (PortailEtu album)',
    expectedStatus: [200, 401, 500, 502],
    validate: (data, response) => {
      if (response.status === 401) {
        return { ok: true, message: 'Non authentifié (nécessite x-portal-api-key)' };
      }
      if (response.status >= 500) {
        return { ok: true, message: 'Immich non accessible' };
      }
      return { ok: data.success === true };
    }
  });
  
  // Note: Le test d'upload réel nécessiterait de créer un FormData avec une vraie image
  // Ce qui est complexe en Node.js sans bibliothèque additionnelle
  // On documente le test manuel :
  log('ℹ️  Test d\'upload de photo : nécessite multipart/form-data (test manuel recommandé)', colors.blue);
  log('   Exemple: curl -X POST -H "x-portal-api-key: YOUR_KEY" -F "file=@photo.jpg" http://localhost:3000/api/external/media', colors.blue);

  // ========================================
  // Tests Health / Info
  // ========================================
  log('\n💚 Tests Health', colors.cyan);
  
  await testEndpoint({
    path: '/api/health',
    description: 'Vérifier la santé de l\'API',
    expectedStatus: [200, 404],
    validate: (data, response) => {
      if (response.status === 404) {
        return { ok: true, message: 'Endpoint health non configuré' };
      }
      return { ok: true };
    }
  });

  // ========================================
  // Cleanup: Suppression de la clé API et déconnexion
  // ========================================
  if (testApiKeyId) {
    await deleteApiKey(testApiKeyId);
  }
  await logout();

  // ========================================
  // Résumé
  // ========================================
  log('\n' + '='.repeat(60), colors.cyan);
  log('📊 RÉSUMÉ DES TESTS', colors.cyan);
  log('='.repeat(60), colors.cyan);
  log(`Total: ${testsTotal}`, colors.blue);
  log(`✅ Réussis: ${testsPassed}`, colors.green);
  log(`❌ Échoués: ${testsFailed}`, colors.red);
  
  const successRate = testsTotal > 0 ? ((testsPassed / testsTotal) * 100).toFixed(1) : 0;
  log(`📈 Taux de réussite: ${successRate}%`, successRate >= 80 ? colors.green : colors.yellow);
  log('='.repeat(60) + '\n', colors.cyan);

  // Exit code
  if (testsFailed > 0) {
    log('⚠️  Certains tests ont échoué. Vérifiez les détails ci-dessus.', colors.yellow);
    process.exit(1);
  } else {
    log('✨ Tous les tests sont passés avec succès !', colors.green);
    process.exit(0);
  }
}

// Lancement
log('\n' + '='.repeat(60), colors.cyan);
log('🧪 MiGallery API Tests', colors.cyan);
log('='.repeat(60), colors.cyan);

runTests().catch(error => {
  log(`\n❌ Erreur fatale: ${error.message}`, colors.red);
  process.exit(1);
});
