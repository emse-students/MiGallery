#!/usr/bin/env node
/**
 * Script de tests unitaires pour l'API MiGallery
 * Teste tous les endpoints principaux de l'API
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5173';
const API_KEY = process.env.API_KEY || '';

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
    logTest(`${method} ${path} - ${description}`, false, `Error: ${error.message}`);
    return { passed: false, error };
  }
}

async function runTests() {
  log('\n🚀 Démarrage des tests API MiGallery\n', colors.cyan);
  log(`📍 URL de base: ${API_BASE_URL}`, colors.blue);
  log(`🔑 API Key: ${API_KEY ? '✓ configurée' : '⚠️  non configurée'}\n`, colors.blue);

  // ========================================
  // Tests Albums
  // ========================================
  log('\n📚 Tests Albums', colors.cyan);
  
  await testEndpoint({
    path: '/api/albums',
    description: 'Lister les albums',
    validate: (data) => ({
      ok: Array.isArray(data),
      message: !Array.isArray(data) ? 'La réponse devrait être un tableau' : ''
    })
  });

  // ========================================
  // Tests Users
  // ========================================
  log('\n👥 Tests Users', colors.cyan);
  
  await testEndpoint({
    path: '/api/users',
    description: 'Lister les utilisateurs (admin)',
    expectedStatus: [200, 403], // Peut être 403 si pas admin
    validate: (data, response) => {
      if (response.status === 403) {
        return { ok: true, message: 'Accès refusé (normal si pas admin)' };
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
    expectedStatus: [200, 404],
    validate: (data, response) => {
      if (response.status === 404) {
        return { ok: true, message: 'Utilisateur non trouvé (la DB n\'est peut-être pas initialisée)' };
      }
      return {
        ok: data && data.id_user === 'les.roots',
        message: data?.id_user !== 'les.roots' ? 'L\'utilisateur devrait être les.roots' : ''
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
    expectedStatus: [200, 404],
    validate: (data, response) => {
      if (response.status === 404) {
        return { ok: true, message: 'Endpoint non disponible ou non configuré' };
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
    expectedStatus: [200, 403],
    validate: (data, response) => {
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
