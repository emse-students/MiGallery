

/**
 * Représentation d'un utilisateur dans l'application
 * Utilisé pour les sessions, les permissions et l'affichage
 */
export interface User {
	id_user: string;
	email: string;
	prenom: string;
	nom: string;
	id_photos?: string | null;
	role?: 'admin' | 'mitviste' | 'user';
	promo_year?: number | null;
	first_login?: number;
}

/**
 * Représentation d'un utilisateur tel que retourné par la base de données
 * Tous les champs sont explicitement nullable pour correspondre à SQLite
 */
export interface UserRow {
	id_user: string;
	email: string;
	prenom: string;
	nom: string;
	id_photos: string | null;
	role: string | null;
	promo_year: number | null;
	first_login: number;
}

/**
 * Données requises pour éditer/créer un utilisateur
 * Tous les champs obligatoires pour garantir la cohérence
 */
export interface EditUserData {
	id_user: string;
	email: string;
	prenom: string;
	nom: string;
	id_photos: string;
	role: 'admin' | 'mitviste' | 'user';
	promo_year: number | null;
}

/**
 * Métadonnées d'un album (pour création/modification)
 */
export interface AlbumMetadata {
	name: string;
	date?: string | null;
	location?: string | null;
	visibility?: 'private' | 'authenticated' | 'unlisted';
	visible?: boolean;
}

/**
 * Représentation complète d'un album
 * Utilisé pour l'affichage et les manipulations
 */
export interface Album {
	id: string;
	name: string;
	date?: string | null;
	location?: string | null;
	visibility?: 'private' | 'authenticated' | 'unlisted';
	visible?: number | boolean;
}

/**
 * Album tel que stocké dans la base de données
 * Correspond exactement à la structure de la table SQLite
 */
export interface AlbumRow {
	id: string; // immich UUID
	name: string;
	date?: string | null;
	location?: string | null;
	visibility: 'private' | 'authenticated' | 'unlisted';
	visible?: number | boolean;
}

/**
 * Réponse API générique pour tous les endpoints
 * @template T Type de données retournées
 */
export interface ApiResponse<T = unknown> {
	success?: boolean;
	data?: T;
	error?: string;
	message?: string;
}

/**
 * Résultat d'une inspection de la base de données
 */
export interface DbInspectionResult {
	hasErrors: boolean;
	errors?: string[];
	message?: string;
}

/**
 * Asset (photo/vidéo) tel que retourné par l'API Immich
 * Documentation complète des champs disponibles
 */
export interface ImmichAsset {
	id: string;
	type?: string;
	originalPath?: string;
	originalFileName?: string;
	resized?: boolean;
	thumbhash?: string;
	fileCreatedAt?: string;
	fileModifiedAt?: string;
	createdAt?: string;
	updatedAt?: string;
	deletedAt?: string;
	takenAt?: string;
	localDateTime?: string;
	isFavorite?: boolean;
	isArchived?: boolean;
	duration?: string;
	width?: number;
	height?: number;
	exifInfo?: {
		dateTimeOriginal?: string;
		timeZone?: string;
		city?: string;
		state?: string;
		country?: string;
		make?: string;
		model?: string;
		lensModel?: string;
		fNumber?: number;
		focalLength?: number;
		iso?: number;
		exposureTime?: string;
		latitude?: number;
		longitude?: number;
		exifImageWidth?: number;
		exifImageHeight?: number;
		orientation?: string;
		description?: string;
		projectionType?: string;
	};
	people?: Array<{
		id: string;
		name?: string;
		birthDate?: string;
	}>;
	checksum?: string;
	deviceAssetId?: string;
	deviceId?: string;
	libraryId?: string;
	ownerId?: string;
}

/**
 * Album tel que retourné par l'API Immich
 */
export interface ImmichAlbum {
	id: string;
	albumName?: string;
	description?: string;
	albumThumbnailAssetId?: string;
	shared?: boolean;
	sharedUsers?: unknown[];
	assets?: ImmichAsset[];
	assetCount?: number;
	owner?: {
		id: string;
		email?: string;
		name?: string;
	};
	createdAt?: string;
	updatedAt?: string;
	lastModifiedAssetTimestamp?: string;
}

/**
 * Réponse paginée de l'API Immich
 * @template T Type des items retournés
 */
export interface ImmichPaginatedResponse<T> {
	items: T[];
	nextPage?: string | null;
}

/**
 * Utilisateur dans une session (Auth.js)
 */
export interface SessionUser {
	id?: string;
	email?: string;
	preferred_username?: string;
	sub?: string;
	[key: string]: unknown;
}

/**
 * Session d'authentification complète
 */
export interface AuthSession {
	user?: SessionUser | null;
}

/**
 * Interface pour les cookies SvelteKit
 * Simplifie le typage des opérations sur les cookies
 */
export interface CookiesAPI {
	get: (name: string) => string | undefined;
	set: (name: string, value: string, opts?: unknown) => void;
}

/**
 * Réponse de création d'une clé API
 */
export interface ApiKeyResponse {
	success?: boolean;
	rawKey?: string;
	id?: string;
}

/**
 * Liste des utilisateurs (endpoint /api/users)
 */
export interface UsersListResponse {
	success: boolean;
	users: UserRow[];
}

/**
 * Détails d'un utilisateur (endpoint /api/users/:id)
 */
export interface UserResponse {
	success: boolean;
	user: UserRow;
}

/**
 * Réponse de création d'utilisateur
 */
export interface UserCreateResponse {
	success: boolean;
	created: UserRow;
}

/**
 * Clé API dans la liste
 */
export interface ApiKeyItem {
	id: string;
	label: string;
	scopes: string;
	created_at: number;
	revoked: boolean;
}

/**
 * Liste des clés API (endpoint /api/admin/api-keys)
 */
export interface ApiKeysListResponse {
	success: boolean;
	keys: ApiKeyItem[];
}

/**
 * Statut de santé de l'API (endpoint /api/health)
 */
export interface HealthResponse {
	status: string;
	timestamp?: string;
	database?: string;
}
