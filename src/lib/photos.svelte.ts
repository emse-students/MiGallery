import { fetchArchive, saveBlobAs } from '$lib/immich/download';

export type Asset = { 
  id: string; 
  originalFileName?: string; 
  type?: string;
  date?: string | null;
  _raw?: any;
};

export function formatDayLabel(dateStr: string | null) {
  if (!dateStr) return 'Sans date';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Sans date';
  
  // Parse as local date to avoid timezone issues
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();
  
  // Calculate day difference
  const dMid = new Date(year, month, day);
  const tMid = new Date(todayYear, todayMonth, todayDay);
  const diff = Math.round((tMid.getTime() - dMid.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diff === 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  return dMid.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

export function groupByDay(list: Asset[]) {
  const out: Record<string, Asset[]> = {};
  for (const a of list) {
    const key = formatDayLabel(a.date || null);
    out[key] = out[key] || [];
    out[key].push(a);
  }
  return out;
}

export class PhotosState {
  assets = $state<Asset[]>([]);
  selectedAssets = $state<string[]>([]);
  selecting = $state(false);
  loading = $state(false);
  error = $state<string | null>(null);
  imageUrl = $state<string | null>(null);
  _prevImageUrl = $state<string | null>(null);
  personName = $state<string>('');
  peopleId = $state<string>('');
  isDownloading = $state(false);
  downloadProgress = $state(0);
  currentDownloadController: AbortController | null = null;

  /**
   * Charge TOUTES les photos d'une personne SAUF celles dans l'album PhotoCV
   * Utilisé par: page "Mes photos"
   */
  async loadPerson(id: string) {
    if (!id) {
      this.error = "Aucun id_photos configuré pour cet utilisateur";
      return;
    }
    
    this.loading = true;
    this.error = null;
    this.assets = [];
    this.imageUrl = null;
    this.personName = '';
    this.peopleId = id;
    
    try {
      // Récupérer les infos de la personne
      const personRes = await fetch(`/api/immich/people/${id}`);
      if (personRes.ok) {
        const personData = await personRes.json();
        this.personName = personData.name || 'Sans nom';
      }

      // Récupérer la photo de profil
      const thumb = await fetch(`/api/immich/people/${id}/thumbnail`);
      if (thumb.ok) {
        const blob = await thumb.blob();
        if (this._prevImageUrl) {
          URL.revokeObjectURL(this._prevImageUrl);
          this._prevImageUrl = null;
        }
        const url = URL.createObjectURL(blob);
        this.imageUrl = url;
        this._prevImageUrl = url;
      }

      // Utiliser l'endpoint qui filtre les photos HORS album PhotoCV
      const res = await fetch(`/api/photos-cv?action=my-photos&personId=${id}`);

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      const allAssets = data.assets || [];

      this.assets = allAssets.map((it: any) => ({
        id: it.id,
        originalFileName: it.originalFileName,
        date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
        type: it.type,
        _raw: it
      }));
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Charge les photos d'une personne DANS l'album PhotoCV
   * Utilisé par: page Photos CV (onglet "Mes photos CV")
   */
  async loadMyPhotosCV(id: string) {
    if (!id) {
      this.error = "Aucun id_photos configuré pour cet utilisateur";
      return;
    }
    
    this.loading = true;
    this.error = null;
    this.assets = [];
    
    try {
      // Utiliser l'endpoint qui filtre les photos DANS l'album PhotoCV pour cette personne
      const res = await fetch(`/api/photos-cv?action=album-photos&personId=${id}`);

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      const allAssets = data.assets || [];

      this.assets = allAssets.map((it: any) => ({
        id: it.id,
        originalFileName: it.originalFileName,
        date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
        type: it.type,
        _raw: it
      }));
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Charge TOUTES les photos DANS l'album PhotoCV (toutes personnes confondues)
   * Utilisé par: page Photos CV (onglet "Toutes les photos CV" - mitvistes/admins uniquement)
   */
  async loadAllPhotosCV() {
    this.loading = true;
    this.error = null;
    this.assets = [];
    
    try {
      // Utiliser l'endpoint qui récupère TOUTES les photos de l'album PhotoCV
      const res = await fetch(`/api/photos-cv?action=all-album-photos`);

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      const allAssets = data.assets || [];

      this.assets = allAssets.map((it: any) => ({
        id: it.id,
        originalFileName: it.originalFileName,
        date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
        type: it.type,
        _raw: it
      }));
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  toggleSelect(id: string, checked: boolean) {
    if (checked) {
      if (!this.selectedAssets.includes(id)) {
        this.selectedAssets = [...this.selectedAssets, id];
        this.selecting = true;
      }
    } else {
      this.selectedAssets = this.selectedAssets.filter(x => x !== id);
      if (this.selectedAssets.length === 0) this.selecting = false;
    }
  }

  handlePhotoClick(id: string, event: Event) {
    if (this.selecting) {
      event.preventDefault();
      const isSelected = this.selectedAssets.includes(id);
      this.toggleSelect(id, !isSelected);
    } else {
      // Utiliser goto au lieu de window.location.href pour éviter le rechargement complet
      import('$app/navigation').then(({ goto }) => {
        goto(`/asset/${id}`);
      });
    }
  }
  
  selectAll() {
    this.selectedAssets = this.assets.map(a => a.id);
  }
  
  deselectAll() {
    this.selectedAssets = [];
    this.selecting = false;
  }

  async downloadSingle(id: string) {
    const asset = this.assets.find(x => x.id === id);
    const res = await fetch(`/api/immich/assets/${id}/original`);
    if (!res.ok) throw new Error('Erreur téléchargement');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = asset?.originalFileName || id;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async downloadSelected() {
    if (this.selectedAssets.length === 0) return alert('Aucune image sélectionnée');
    if (!confirm(`Télécharger ${this.selectedAssets.length} image(s) sous forme d'archive ?`)) return;
    
    if (this.currentDownloadController) {
      this.currentDownloadController.abort();
      this.currentDownloadController = null;
    }
    const controller = new AbortController();
    this.currentDownloadController = controller;
    this.isDownloading = true;
    this.downloadProgress = 0;
    try {
      const blob = await fetchArchive(this.selectedAssets, {
        onProgress: (p) => { this.downloadProgress = p; },
        signal: controller.signal,
      });
      saveBlobAs(blob, `mes-photos.zip`);
      this.selectedAssets = [];
      this.selecting = false;
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        alert('Erreur: ' + (e as Error).message);
      }
    } finally {
      this.isDownloading = false;
      this.downloadProgress = 0;
      this.currentDownloadController = null;
    }
  }

  cleanup() {
    if (this.currentDownloadController) {
      this.currentDownloadController.abort();
      this.currentDownloadController = null;
    }
    if (this._prevImageUrl) {
      URL.revokeObjectURL(this._prevImageUrl);
      this._prevImageUrl = null;
    }
  }
}
