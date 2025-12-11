import { fetchArchive, saveBlobAs } from '$lib/immich/download';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import { consumeNDJSONStream } from '$lib/streaming';
import { showConfirm } from '$lib/confirm';
import { toast } from '$lib/toast';

export type Asset = {
	id: string;
	originalFileName?: string;
	type?: string;
	date?: string | null;
	width?: number;
	height?: number;
	fileCreatedAt?: string;
	createdAt?: string;
	updatedAt?: string;
	isFavorite?: boolean;
	exifInfo?: {
		exifImageWidth?: number;
		exifImageHeight?: number;
	} | null;
	_raw?: ImmichAsset;
};

export function formatDayLabel(dateStr: string | null) {
	if (!dateStr) {
		return 'Sans date';
	}
	const d = new Date(dateStr);
	if (isNaN(d.getTime())) {
		return 'Sans date';
	}

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

	if (diff === 0) {
		return "Aujourd'hui";
	}
	if (diff === 1) {
		return 'Hier';
	}
	return dMid.toLocaleDateString(undefined, {
		weekday: 'long',
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});
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
	#assets = $state<Asset[]>([]);
	#selectedAssets = $state<string[]>([]);
	#selecting = $state(false);
	#loading = $state(false);
	#error = $state<string | null>(null);
	#imageUrl = $state<string | null>(null);
	#_prevImageUrl = $state<string | null>(null);
	#personName = $state<string>('');
	#peopleId = $state<string>('');
	#isDownloading = $state(false);
	#downloadProgress = $state(0);
	currentDownloadController: AbortController | null = null;

	get assets() {
		return this.#assets;
	}
	set assets(value) {
		this.#assets = value;
	}

	get selectedAssets() {
		return this.#selectedAssets;
	}
	set selectedAssets(value) {
		this.#selectedAssets = value;
	}

	get selecting() {
		return this.#selecting;
	}
	set selecting(value) {
		this.#selecting = value;
	}

	get loading() {
		return this.#loading;
	}
	set loading(value) {
		this.#loading = value;
	}

	get error() {
		return this.#error;
	}
	set error(value) {
		this.#error = value;
	}

	get imageUrl() {
		return this.#imageUrl;
	}
	set imageUrl(value) {
		this.#imageUrl = value;
	}

	get _prevImageUrl() {
		return this.#_prevImageUrl;
	}
	set _prevImageUrl(value) {
		this.#_prevImageUrl = value;
	}

	get personName() {
		return this.#personName;
	}
	set personName(value) {
		this.#personName = value;
	}

	get peopleId() {
		return this.#peopleId;
	}
	set peopleId(value) {
		this.#peopleId = value;
	}

	get isDownloading() {
		return this.#isDownloading;
	}
	set isDownloading(value) {
		this.#isDownloading = value;
	}

	get downloadProgress() {
		return this.#downloadProgress;
	}
	set downloadProgress(value) {
		this.#downloadProgress = value;
	}

	/**
	 * Charge TOUTES les photos d'une personne SAUF celles dans l'album PhotoCV
	 * Utilisé par: page "Mes photos"
	 */
	async loadPerson(id: string) {
		if (!id) {
			this.error = 'Aucun id_photos configuré pour cet utilisateur';
			return;
		}

		this.loading = true;
		this.error = null;
		this.assets = [];
		this.imageUrl = null;
		this.personName = '';
		this.peopleId = id;

		try {
			// Charger les favoris en parallèle (on ne l'attend pas)
			const favoritesPromise = this.loadFavoritesSet();

			// Récupérer les infos de la personne
			const personRes = await fetch(`/api/immich/people/${id}`);
			if (personRes.ok) {
				const personData = (await personRes.json()) as { name?: string };
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

			// Utiliser le streaming pour charger progressivement
			const res = await fetch(
				`/api/people/people/${encodeURIComponent(id)}/photos-stream?in_album=false`
			);

			const assetsMap = new Map<string, Asset>();

			await consumeNDJSONStream<{
				phase: 'minimal' | 'full';
				asset: ImmichAsset;
			}>(res, ({ phase, asset }) => {
				if (phase === 'minimal') {
					// Phase 1: Installer les skeletons
					assetsMap.set(asset.id, {
						...asset,
						date: null,
						isFavorite: false, // Sera mis à jour avec les favoris chargés en parallèle
						exifInfo:
							asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight
								? {
										exifImageWidth: asset.exifInfo.exifImageWidth,
										exifImageHeight: asset.exifInfo.exifImageHeight
									}
								: null,
						_raw: asset
					}); // Dès qu'on reçoit la première photo, masquer le "Chargement"
					if (assetsMap.size === 1) {
						this.loading = false;
					}
				} else if (phase === 'full') {
					// Phase 2: Enrichir avec les données complètes
					// Préserver le statut favori local
					const existing = assetsMap.get(asset.id);
					assetsMap.set(asset.id, {
						...asset,
						date: asset.fileCreatedAt || asset.createdAt || asset.updatedAt || null,
						isFavorite: existing?.isFavorite ?? false,
						_raw: asset
					});
				}

				// Mettre à jour la liste affichée - utiliser spread pour créer un nouveau tableau
				this.assets = [...Array.from(assetsMap.values())];
			});

			// Attendre les favoris et les appliquer
			const favoriteSet = await favoritesPromise;
			this.assets = this.assets.map((a) => ({
				...a,
				isFavorite: favoriteSet.has(a.id)
			}));

			this.loading = false;
		} catch (e: unknown) {
			const _err = ensureError(e);
			this.error = (e as Error).message;
			this.loading = false;
		}
	}

	/**
	 * Charge les photos d'une personne DANS l'album PhotoCV
	 * Utilisé par: page Photos CV (onglet "Mes photos CV")
	 */
	async loadMyPhotosCV(id: string): Promise<void> {
		console.warn('📸 PhotosState.loadMyPhotosCV appelé:', id);
		if (!id) {
			this.error = 'Aucun id_photos configuré pour cet utilisateur';
			console.warn("  ✗ Pas d'id");
			return;
		}

		this.loading = true;
		this.error = null;
		this.assets = [];

		try {
			// Utiliser l'endpoint RESTful qui filtre les photos DANS l'album PhotoCV pour cette personne
			const res = await fetch(`/api/people/people/${encodeURIComponent(id)}/photos?in_album=true`);

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { assets?: ImmichAsset[] };
			const allAssets = data.assets || [];

			this.assets = allAssets.map((it) => ({
				id: it.id,
				originalFileName: it.originalFileName,
				type: it.type,
				fileCreatedAt: it.fileCreatedAt,
				createdAt: it.createdAt,
				updatedAt: it.updatedAt,
				date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
				isFavorite: false, // Ignorer le favori Immich
				_raw: it
			}));
		} catch (e: unknown) {
			const _err = ensureError(e);
			this.error = (e as Error).message;
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Charge la première page des photos DANS l'album PhotoCV (pagination, 100 par défaut)
	 * Utilisé par: page Photos CV (onglet "Toutes les photos CV" - mitvistes/admins uniquement)
	 */
	async loadAllPhotosCV(limit: number = 100): Promise<void> {
		console.warn('📸 PhotosState.loadAllPhotosCV appelé, page 1, limit:', limit);
		this.loading = true;
		this.error = null;
		this.assets = [];
		this.photoCVCurrentPage = 1;

		try {
			// Utiliser l'endpoint avec pagination
			const res = await fetch(`/api/people/album?page=1&limit=${limit}`);

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as {
				assets?: ImmichAsset[];
				hasMore?: boolean;
				totalCount?: number;
				currentPage?: number;
			};
			const allAssets = data.assets || [];

			this.assets = allAssets.map((it) => ({
				...it,
				date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
				isFavorite: false, // Ignorer le favori Immich
				_raw: it
			}));
			this.photoCVHasMore = data.hasMore ?? false;
			this.photoCVTotalCount = data.totalCount ?? 0;
			this.photoCVCurrentPage = data.currentPage ?? 1;
		} catch (e: unknown) {
			const _err = ensureError(e);
			this.error = (e as Error).message;
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Charge la page suivante des photos PhotoCV
	 */
	async loadNextPagePhotosCV(limit: number = 100): Promise<void> {
		const nextPage = this.photoCVCurrentPage + 1;
		console.warn('📸 PhotosState.loadNextPagePhotosCV appelé, page:', nextPage);
		this.loading = true;
		this.error = null;

		try {
			const res = await fetch(`/api/people/album?page=${nextPage}&limit=${limit}`);

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as {
				assets?: ImmichAsset[];
				hasMore?: boolean;
				totalCount?: number;
				currentPage?: number;
			};
			const pageAssets = data.assets || [];

			// Remplacer les assets (pas ajouter)
			const newAssets = pageAssets.map((it) => ({
				...it,
				date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
				isFavorite: false,
				_raw: it
			}));
			this.assets = newAssets;
			this.photoCVHasMore = data.hasMore ?? false;
			this.photoCVTotalCount = data.totalCount ?? 0;
			this.photoCVCurrentPage = nextPage;
		} catch (e: unknown) {
			const _err = ensureError(e);
			this.error = (e as Error).message;
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Charge la page précédente des photos PhotoCV
	 */
	async loadPrevPagePhotosCV(limit: number = 100): Promise<void> {
		const prevPage = Math.max(1, this.photoCVCurrentPage - 1);
		if (prevPage === this.photoCVCurrentPage) {
			return; // Déjà à la page 1
		}
		console.warn('📸 PhotosState.loadPrevPagePhotosCV appelé, page:', prevPage);
		this.loading = true;
		this.error = null;

		try {
			const res = await fetch(`/api/people/album?page=${prevPage}&limit=${limit}`);

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as {
				assets?: ImmichAsset[];
				hasMore?: boolean;
				totalCount?: number;
				currentPage?: number;
			};
			const pageAssets = data.assets || [];

			// Remplacer les assets (pas ajouter)
			const newAssets = pageAssets.map((it) => ({
				...it,
				date: it.fileCreatedAt || it.createdAt || it.updatedAt || null,
				isFavorite: false,
				_raw: it
			}));
			this.assets = newAssets;
			this.photoCVHasMore = data.hasMore ?? false;
			this.photoCVTotalCount = data.totalCount ?? 0;
			this.photoCVCurrentPage = prevPage;
		} catch (e: unknown) {
			const _err = ensureError(e);
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
			this.selectedAssets = this.selectedAssets.filter((x) => x !== id);
			if (this.selectedAssets.length === 0) {
				this.selecting = false;
			}
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
		this.selectedAssets = [...this.assets].map((a) => a.id);
	}

	deselectAll() {
		this.selectedAssets = [];
		this.selecting = false;
	}

	async downloadSingle(id: string) {
		const asset = this.assets.find((x) => x.id === id);
		const res = await fetch(`/api/immich/assets/${id}/original`);
		if (!res.ok) {
			throw new Error('Erreur téléchargement');
		}
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

	async downloadSelected(skipConfirm?: boolean) {
		if (this.selectedAssets.length === 0) {
			toast.error('Aucune image sélectionnée');
			return;
		}
		if (!skipConfirm) {
			const ok = await showConfirm(
				`Télécharger ${this.selectedAssets.length} image(s) sous forme d'archive ?`,
				'Télécharger'
			);
			if (!ok) {
				return;
			}
		}

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
				onProgress: (p) => {
					this.downloadProgress = p;
				},
				signal: controller.signal
			});
			saveBlobAs(blob, 'mes-photos.zip');
			this.selectedAssets = [];
			this.selecting = false;
		} catch (e: unknown) {
			const _err = ensureError(e);
			const err = e as { name?: string; message?: string };
			if (err.name !== 'AbortError') {
				toast.error(`Erreur: ${err.message || 'Erreur inconnue'}`);
			}
		} finally {
			this.isDownloading = false;
			this.downloadProgress = 0;
			this.currentDownloadController = null;
		}
	}

	/**
	 * Charge les assets d'un album avec streaming et cache client
	 * Utilisé par: /albums/[id]
	 */
	async loadAlbumWithStreaming(
		albumId: string,
		albumName?: string,
		visibility?: string
	): Promise<void> {
		console.warn('📸 PhotosState.loadAlbumWithStreaming appelé:', albumId, albumName);
		this.loading = true;
		this.error = null;
		this.assets = [];
		this.personName = albumName || 'Album';

		try {
			console.warn('  🔄 Récupération des assets via streaming...');
			const qp = visibility ? `?visibility=${encodeURIComponent(visibility)}` : '';
			const res = await fetch(`/api/albums/${albumId}/assets-stream${qp}`);

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}

			const assetsMap = new Map<string, Asset>();

			await consumeNDJSONStream<{
				phase: 'minimal' | 'full';
				asset: ImmichAsset;
			}>(res, ({ phase, asset }) => {
				if (phase === 'minimal') {
					// Phase 1: Installer les skeletons
					assetsMap.set(asset.id, {
						...asset,
						date: asset.fileCreatedAt || asset.createdAt || asset.updatedAt || null,
						isFavorite: false, // Ignorer le favori Immich
						exifInfo:
							asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight
								? {
										exifImageWidth: asset.exifInfo.exifImageWidth,
										exifImageHeight: asset.exifInfo.exifImageHeight
									}
								: null,
						_raw: asset
					}); // Dès qu'on reçoit la première photo, masquer le "Chargement"
					if (assetsMap.size === 1) {
						this.loading = false;
					}
				} else if (phase === 'full') {
					// Phase 2: Enrichir avec les données complètes
					// Préserver le statut favori local
					const existing = assetsMap.get(asset.id);
					assetsMap.set(asset.id, {
						...asset,
						date: asset.fileCreatedAt || asset.createdAt || asset.updatedAt || null,
						isFavorite: existing?.isFavorite ?? false,
						_raw: asset
					});
				}

				// Mettre à jour la liste affichée - utiliser spread pour créer un nouveau tableau
				this.assets = [...Array.from(assetsMap.values())];
			});

			this.loading = false;
			console.warn('  ✓ Chargement complété, assets:', this.assets.length);
		} catch (e: unknown) {
			const _err = ensureError(e);
			this.error = (e as Error).message;
			this.loading = false;
			console.warn('  ✗ Erreur:', this.error);
		}
	}

	/**
	 * Toggle le statut favori d'un asset (stocké localement par utilisateur)
	 * @param assetId - ID de l'asset
	 * @returns Le nouveau statut favori
	 */
	async toggleFavorite(assetId: string): Promise<boolean> {
		const asset = this.assets.find((a) => a.id === assetId);
		if (!asset) {
			throw new Error('Asset non trouvé');
		}

		const newFavoriteStatus = !asset.isFavorite;

		try {
			const res = await fetch('/api/favorites', {
				method: newFavoriteStatus ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ assetId })
			});

			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `HTTP ${res.status}`);
			}

			// Mettre à jour l'asset localement
			this.assets = this.assets.map((a) =>
				a.id === assetId ? { ...a, isFavorite: newFavoriteStatus } : a
			);

			return newFavoriteStatus;
		} catch (e: unknown) {
			const err = ensureError(e);
			throw err;
		}
	}

	/**
	 * Charge les favoris de l'utilisateur et retourne un Set
	 * Utile pour charger en parallèle du streaming
	 */
	async loadFavoritesSet(): Promise<Set<string>> {
		try {
			const res = await fetch('/api/favorites');
			if (!res.ok) {
				return new Set();
			}

			const data = (await res.json()) as { favorites: string[] };
			return new Set(data.favorites);
		} catch (e: unknown) {
			console.warn('Erreur chargement favoris:', e);
			return new Set();
		}
	}

	/**
	 * Charge les favoris de l'utilisateur et met à jour les assets
	 */
	async loadFavorites(): Promise<void> {
		try {
			const res = await fetch('/api/favorites');
			if (!res.ok) {
				return;
			}

			const data = (await res.json()) as { favorites: string[] };
			const favoriteSet = new Set(data.favorites);

			// Mettre à jour le statut favori des assets
			this.assets = this.assets.map((a) => ({
				...a,
				isFavorite: favoriteSet.has(a.id)
			}));
		} catch (e: unknown) {
			console.warn('Erreur chargement favoris:', e);
		}
	}

	/**
	 * Retourne les assets favoris
	 */
	get favorites(): Asset[] {
		return this.assets.filter((a) => a.isFavorite);
	}

	/**
	 * Retourne les assets non-favoris
	 */
	get nonFavorites(): Asset[] {
		return this.assets.filter((a) => !a.isFavorite);
	}

	// Pagination pour loadAllPhotosCV
	#photoCVCurrentPage = $state(1);
	#photoCVHasMore = $state(false);
	#photoCVTotalCount = $state(0);

	get photoCVCurrentPage() {
		return this.#photoCVCurrentPage;
	}
	set photoCVCurrentPage(value) {
		this.#photoCVCurrentPage = value;
	}

	get photoCVHasMore() {
		return this.#photoCVHasMore;
	}
	set photoCVHasMore(value) {
		this.#photoCVHasMore = value;
	}

	get photoCVTotalCount() {
		return this.#photoCVTotalCount;
	}
	set photoCVTotalCount(value) {
		this.#photoCVTotalCount = value;
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
