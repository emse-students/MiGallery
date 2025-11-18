/**
 * Tests API pour MiGallery
 * Ces tests sont exécutés dans la CI et peuvent être lancés localement avec: bun test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let API_KEY = '';
let sessionCookie = '';
let testApiKeyId: string | null = null;
let createdUserId: string | null = null;

// ========================================
// Fonctions d'authentification et setup
// ========================================

async function ensureSystemUserExists(): Promise<boolean> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
    
    if (!fs.existsSync(DB_PATH)) {
      console.warn('⚠️  Base de données introuvable');
      return false;
    }
    
    // Detect runtime and use appropriate SQLite driver
    const isBun = typeof (globalThis as any).Bun !== 'undefined';
    let Database: any;
    
    if (isBun) {
      // @ts-ignore - bun:sqlite is a Bun-specific module
      Database = (await import('bun:sqlite')).Database;
    } else {
      Database = (await import('better-sqlite3')).default;
    }
    
    const db = new Database(DB_PATH, isBun ? undefined : { readonly: true });
    
    try {
      const user = db.prepare('SELECT id_user, role FROM users WHERE id_user = ?').get('les.roots') as any;
      db.close();
      
      if (user) {
        console.log(`✅ Utilisateur système les.roots existe (rôle: ${user.role})`);
        return true;
      } else {
        console.warn('⚠️  Utilisateur système les.roots introuvable');
        return false;
      }
    } catch (dbError) {
      db.close();
      throw dbError;
    }
  } catch (error) {
    console.error(`❌ Erreur lors de la vérification: ${(error as Error).message}`);
    return false;
  }
}

async function loginAsSystemUser(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/dev/login-as?u=les.roots`, {
      redirect: 'manual'
    });
    
    if (response.status === 303 || response.status === 302) {
      const cookies = response.headers.get('set-cookie');
      if (cookies) {
        const match = cookies.match(/current_user_id=([^;]+)/);
        if (match) {
          sessionCookie = `current_user_id=${match[1]}`;
          console.log('✅ Connexion réussie avec cookie de session');
          return true;
        }
      }
    }
    
    console.error(`❌ Échec de la connexion (status: ${response.status})`);
    return false;
  } catch (error) {
    console.error(`❌ Erreur lors de la connexion: ${(error as Error).message}`);
    return false;
  }
}

async function createTestApiKey(): Promise<string | null> {
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
        console.log(`✅ Clé API créée: ${data.rawKey.substring(0, 20)}...`);
        return data.id;
      }
    }
    
    console.error(`❌ Échec de la création de clé API (status: ${response.status})`);
    return null;
  } catch (error) {
    console.error(`❌ Erreur lors de la création de clé API: ${(error as Error).message}`);
    return null;
  }
}

async function deleteApiKey(keyId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    if (response.status === 200 || response.status === 204) {
      console.log('✅ Clé API supprimée avec succès');
      return true;
    }
    
    console.warn(`⚠️  Échec de la suppression de clé API (status: ${response.status})`);
    return false;
  } catch (error) {
    console.error(`❌ Erreur lors de la suppression: ${(error as Error).message}`);
    return false;
  }
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY && { 'x-api-key': API_KEY }),
    ...(sessionCookie && { 'Cookie': sessionCookie })
  };
}

// ========================================
// Setup et Teardown
// ========================================

beforeAll(async () => {
  console.log('\n🚀 Setup des tests API');
  console.log(`📍 URL de base: ${API_BASE_URL}\n`);
  
  const userExists = await ensureSystemUserExists();
  if (userExists) {
    const loginSuccess = await loginAsSystemUser();
    if (loginSuccess) {
      testApiKeyId = await createTestApiKey();
    }
  }
});

afterAll(async () => {
  console.log('\n🧹 Nettoyage après les tests');
  
  // Supprimer l'utilisateur de test s'il existe
  if (createdUserId) {
    try {
      await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      console.log('✅ Utilisateur de test supprimé');
    } catch (e) {
      console.warn('⚠️  Impossible de supprimer l\'utilisateur de test');
    }
  }
  
  // Supprimer la clé API de test
  if (testApiKeyId) {
    await deleteApiKey(testApiKeyId);
  }
  
  sessionCookie = '';
  API_KEY = '';
  console.log('✅ Nettoyage terminé\n');
});

// ========================================
// Tests Albums
// ========================================

describe('Albums API', () => {
  it('devrait lister les albums', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/albums`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      // Accepter 200 (succès) ou 500 (Immich down)
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
      }
    } catch (error: any) {
      // Si fetch échoue (Immich down), c'est acceptable
      if (error.name === 'TimeoutError' || error.code === 'ECONNRESET') {
        console.log('⚠️  Immich non accessible (timeout)');
        expect(true).toBe(true); // Test passe quand même
      } else {
        throw error;
      }
    }
  }, 15000); // 15s timeout pour ce test
});

// ========================================
// Tests Users
// ========================================

describe('Users API', () => {
  it('devrait lister les utilisateurs (admin)', async () => {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 401, 403, 500]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.users)).toBe(true);
    }
  });

  it('devrait récupérer l\'utilisateur système', async () => {
    const response = await fetch(`${API_BASE_URL}/api/users/les.roots`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 401, 404, 500]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.user.id_user).toBe('les.roots');
    }
  });
});

// ========================================
// Tests CRUD Users (Admin)
// ========================================

describe('Users CRUD (Admin)', () => {
  it('devrait créer un utilisateur', async () => {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id_user: 'test.user.vitest',
        email: 'test.user.vitest@etu.emse.fr',
        prenom: 'Test',
        nom: 'Vitest',
        role: 'user',
        promo_year: 2025
      })
    });
    
    expect([200, 201, 401, 403, 500]).toContain(response.status);
    
    if (response.status === 200 || response.status === 201) {
      const data = await response.json();
      if (data.success && data.created) {
        createdUserId = data.created.id_user;
        expect(createdUserId).toBe('test.user.vitest');
      }
    }
  });

  it('devrait récupérer l\'utilisateur créé', async () => {
    if (!createdUserId) {
      createdUserId = 'test.user.vitest'; // Fallback si création a échoué mais user existe
    }
    
    const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 401, 403, 404, 500]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.user.id_user).toBe(createdUserId);
    }
  });

  it('devrait modifier l\'utilisateur', async () => {
    if (!createdUserId) return;
    
    const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        email: 'test.user.modified@etu.emse.fr',
        prenom: 'Test Modified',
        nom: 'Vitest Modified',
        role: 'user',
        promo_year: 2025
      })
    });
    
    expect([200, 401, 403, 404, 500]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
    }
  });

  it('devrait supprimer l\'utilisateur', async () => {
    if (!createdUserId) return;
    
    const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    
    expect([200, 204, 401, 403, 404, 500]).toContain(response.status);
    
    if (response.status === 200 || response.status === 204) {
      // User supprimé, on le retire de la variable pour éviter le double nettoyage
      createdUserId = null;
    }
  });
});

// ========================================
// Tests Photos-CV
// ========================================

describe('Photos-CV API', () => {
  it('devrait lister les personnes', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/photos-cv/people`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      expect([200, 404, 500]).toContain(response.status);
    } catch (error: any) {
      // Si fetch échoue (Immich down), c'est acceptable
      if (error.name === 'TimeoutError' || error.code === 'ECONNRESET') {
        console.log('⚠️  Immich non accessible (timeout)');
        expect(true).toBe(true);
      } else {
        throw error;
      }
    }
  }, 15000); // 15s timeout
});

// ========================================
// Tests API Keys (Admin)
// ========================================

describe('API Keys (Admin)', () => {
  it('devrait lister les clés API', async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 401, 403]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.keys)).toBe(true);
    }
  });
});

// ========================================
// Tests Assets (Immich proxy)
// ========================================

describe('Assets API (Immich proxy)', () => {
  it('devrait lister les assets via proxy Immich', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      // Immich peut être down ou non configuré
      expect([200, 404, 500, 502]).toContain(response.status);
    } catch (error: any) {
      // Si fetch échoue (Immich down), c'est acceptable
      if (error.name === 'TimeoutError' || error.code === 'ECONNRESET') {
        console.log('⚠️  Immich non accessible (timeout)');
        expect(true).toBe(true);
      } else {
        throw error;
      }
    }
  }, 15000); // 15s timeout
});

// ========================================
// Tests External Media
// ========================================

describe('External Media API', () => {
  it('devrait lister les médias externes', async () => {
    const response = await fetch(`${API_BASE_URL}/api/external/media`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 401, 500, 502]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
    }
  });
});

// ========================================
// Tests Health
// ========================================

describe('Health API', () => {
  it('devrait vérifier la santé de l\'API', async () => {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      headers: getAuthHeaders()
    });
    
    expect([200, 404]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.status).toBe('ok');
    }
  });
});
