/**
 * Script de migration : déplace toutes les photos avec [PhotoCV] dans la description
 * vers le nouvel album PhotoCV caché
 */

const IMMICH_URL = process.env.IMMICH_URL || 'http://10.0.0.4:2283';
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;

if (!IMMICH_API_KEY) {
  console.error('❌ IMMICH_API_KEY non défini dans les variables d\'environnement');
  console.error('Usage: IMMICH_API_KEY=xxx node scripts/migrate-photocv.cjs');
  process.exit(1);
}

const ALBUM_NAME = 'PhotoCV';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Récupère ou crée l'album PhotoCV
 */
async function getOrCreateAlbum() {
  console.log('🔍 Recherche de l\'album PhotoCV...');
  
  const res = await fetch(`${IMMICH_URL}/api/albums`, {
    headers: {
      'x-api-key': IMMICH_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`Erreur lors de la récupération des albums: ${res.statusText}`);
  }

  const albums = await res.json();
  const existing = albums.find(a => a.albumName === ALBUM_NAME);

  if (existing) {
    console.log(`✅ Album "${ALBUM_NAME}" trouvé (ID: ${existing.id})`);
    return existing.id;
  }

  console.log(`📝 Création de l'album "${ALBUM_NAME}"...`);
  const createRes = await fetch(`${IMMICH_URL}/api/albums`, {
    method: 'POST',
    headers: {
      'x-api-key': IMMICH_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      albumName: ALBUM_NAME,
      description: 'Album système pour les photos CV (géré automatiquement - NE PAS SUPPRIMER)'
    })
  });

  if (!createRes.ok) {
    const error = await createRes.text();
    throw new Error(`Erreur lors de la création de l'album: ${error}`);
  }

  const newAlbum = await createRes.json();
  console.log(`✅ Album "${ALBUM_NAME}" créé (ID: ${newAlbum.id})`);
  return newAlbum.id;
}

/**
 * Recherche toutes les images avec pagination
 */
async function getAllImages() {
  console.log('🔍 Recherche de toutes les images...');
  const allAssets = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const res = await fetch(`${IMMICH_URL}/api/search/metadata`, {
      method: 'POST',
      headers: {
        'x-api-key': IMMICH_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'IMAGE',
        page,
        size: 1000
      })
    });

    if (!res.ok) {
      throw new Error(`Erreur recherche (page ${page}): ${res.statusText}`);
    }

    const data = await res.json();
    const items = data.assets?.items || [];

    if (items.length === 0) {
      break;
    }

    allAssets.push(...items);
    console.log(`   📄 Page ${page}: ${items.length} images trouvées (total: ${allAssets.length})`);

    hasNext = data.assets?.nextPage !== null && data.assets?.nextPage !== undefined;
    page++;

    // Sécurité : max 20 pages (20 000 images)
    if (page > 20) {
      console.warn('⚠️  Limite de 20 pages atteinte');
      break;
    }

    await sleep(100); // Éviter de surcharger le serveur
  }

  console.log(`✅ Total: ${allAssets.length} images trouvées`);
  return allAssets;
}

/**
 * Vérifie si un asset a le tag [PhotoCV]
 */
async function hasPhotoCVTag(assetId) {
  const res = await fetch(`${IMMICH_URL}/api/assets/${assetId}`, {
    headers: {
      'x-api-key': IMMICH_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    return false;
  }

  const asset = await res.json();
  const desc = asset.exifInfo?.description || '';
  return /\[\s*PhotoCV\s*\]/i.test(desc);
}

/**
 * Ajoute des assets à l'album par batch
 */
async function addAssetsToAlbum(albumId, assetIds) {
  if (assetIds.length === 0) return;

  // Batch par 100 pour éviter les timeouts
  const batchSize = 100;
  for (let i = 0; i < assetIds.length; i += batchSize) {
    const batch = assetIds.slice(i, i + batchSize);
    
    const res = await fetch(`${IMMICH_URL}/api/albums/${albumId}/assets`, {
      method: 'PUT',
      headers: {
        'x-api-key': IMMICH_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids: batch })
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`❌ Erreur ajout batch ${i / batchSize + 1}: ${error}`);
    } else {
      console.log(`   ✅ Batch ${i / batchSize + 1}: ${batch.length} photos ajoutées`);
    }

    await sleep(200); // Pause entre les batches
  }
}

/**
 * Migration principale
 */
async function migrate() {
  console.log('🚀 Démarrage de la migration des photos CV\n');

  try {
    // 1. Créer ou récupérer l'album
    const albumId = await getOrCreateAlbum();
    console.log('');

    // 2. Récupérer toutes les images
    const allImages = await getAllImages();
    console.log('');

    // 3. Filtrer celles avec le tag [PhotoCV]
    console.log('🔍 Recherche des photos avec le tag [PhotoCV]...');
    const photoCvAssets = [];
    const batchSize = 10;

    for (let i = 0; i < allImages.length; i += batchSize) {
      const batch = allImages.slice(i, i + batchSize);
      const promises = batch.map(async (asset) => {
        const hasTag = await hasPhotoCVTag(asset.id);
        return hasTag ? asset.id : null;
      });

      const results = await Promise.all(promises);
      const found = results.filter(Boolean);
      photoCvAssets.push(...found);

      console.log(`   📄 Traité ${Math.min(i + batchSize, allImages.length)}/${allImages.length} images (${photoCvAssets.length} trouvées)`);

      await sleep(100);
    }

    console.log(`\n✅ ${photoCvAssets.length} photos avec tag [PhotoCV] trouvées`);

    if (photoCvAssets.length === 0) {
      console.log('✨ Aucune photo à migrer !');
      return;
    }

    // 4. Ajouter les photos à l'album
    console.log(`\n📦 Ajout des ${photoCvAssets.length} photos à l'album "${ALBUM_NAME}"...`);
    await addAssetsToAlbum(albumId, photoCvAssets);

    console.log(`\n✅ Migration terminée avec succès !`);
    console.log(`   📊 ${photoCvAssets.length} photos ajoutées à l'album "${ALBUM_NAME}"`);
    console.log(`\n💡 Note: Les tags [PhotoCV] dans les descriptions peuvent être supprimés manuellement si souhaité.`);
  } catch (error) {
    console.error('\n❌ Erreur durant la migration:', error.message);
    process.exit(1);
  }
}

// Lancement
migrate();
