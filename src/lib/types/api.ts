// ============================================================================
// CENTRALIZED TYPES - Single source of truth for the entire application
// ============================================================================

// ----------------------------------------------------------------------------
// Users - Application users
// ----------------------------------------------------------------------------

/**
 * Representation of a user in the application
 * Used for sessions, permissions and display
 */
export interface User {
	id_user: string;
	name: string;
	first_name?: string | null;
	last_name?: string | null;
	photos_id?: string | null;
	role?: 'admin' | 'mitviste' | 'user';
	promo?: number | null;
	formation?: string | null;
	first_login?: number;
}

/**
 * Representation of a user as returned by the database
 * All fields are explicitly nullable to match SQLite
 */
export interface UserRow {
	id_user: string;
	name: string;
	first_name: string | null;
	last_name: string | null;
	photos_id: string | null;
	role: string | null;
	promo: number | null;
	formation?: string | null;
	first_login?: number;
}

/**
 * Data required to edit/create a user
 * All fields required to ensure consistency
 */
export interface EditUserData {
	id_user: string;
	name: string;
	first_name: string | null;
	last_name: string | null;
	photos_id: string | null;
	role: 'admin' | 'mitviste' | 'user';
	promo: number | null;
}

// ----------------------------------------------------------------------------
// Albums - Photo album management
// ----------------------------------------------------------------------------

/**
 * Album metadata (for creation/modification)
 */
export interface AlbumMetadata {
	name: string;
	date?: string | null;
	location?: string | null;
	visibility?: 'private' | 'authenticated' | 'unlisted';
	visible?: boolean;
}

/**
 * Complete representation of an album
 * Used for display and manipulations
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
 * Album as stored in the database
 * Matches exactly the SQLite table structure
 */
export interface AlbumRow {
	id: string; // immich UUID
	name: string;
	date?: string | null;
	location?: string | null;
	visibility: 'private' | 'authenticated' | 'unlisted';
	visible?: number | boolean;
}

// ----------------------------------------------------------------------------
// API Responses - Standardized responses
// ----------------------------------------------------------------------------

/**
 * Generic API response for all endpoints
 * @template T Type of returned data
 */
export interface ApiResponse<T = unknown> {
	success?: boolean;
	data?: T;
	error?: string;
	message?: string;
}

// ----------------------------------------------------------------------------
// Database Operations - Database operations
// ----------------------------------------------------------------------------

/**
 * Result of a database inspection
 */
export interface DbInspectionResult {
	hasErrors: boolean;
	errors?: string[];
	message?: string;
}

// ----------------------------------------------------------------------------
// Immich Integration - Types for the Immich API
// ----------------------------------------------------------------------------

/**
 * Asset (photo/video) as returned by the Immich API
 * Complete documentation of available fields
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
	libraryId?: string;
	ownerId?: string;
}

/**
 * Album as returned by the Immich API
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
 * Paginated response from the Immich API
 * @template T Type of returned items
 */
export interface ImmichPaginatedResponse<T> {
	items: T[];
	nextPage?: string | null;
}

// ----------------------------------------------------------------------------
// Authentication - Types for authentication
// ----------------------------------------------------------------------------

/**
 * User within a session
 */
export interface SessionUser {
	id?: string;
	name?: string;
	first_name?: string | null;
	last_name?: string | null;
	sub?: string;
	[key: string]: unknown;
}

/**
 * Complete authentication session
 */
export interface AuthSession {
	user?: SessionUser | null;
}

/**
 * Interface for SvelteKit cookies
 * Simplifies typing of cookie operations
 */
export interface CookiesAPI {
	get: (name: string) => string | undefined;
	set: (name: string, value: string, opts?: unknown) => void;
}

// ----------------------------------------------------------------------------
// Test Types - Test-specific types (re-exported for consistency)
// ----------------------------------------------------------------------------

/**
 * Response for API key creation
 */
export interface ApiKeyResponse {
	success?: boolean;
	rawKey?: string;
	id?: string;
}

/**
 * List of users (endpoint /api/users)
 */
export interface UsersListResponse {
	success: boolean;
	users: UserRow[];
}

/**
 * Details of a user (endpoint /api/users/:id)
 */
export interface UserResponse {
	success: boolean;
	user: UserRow;
}

/**
 * Response for user creation
 */
export interface UserCreateResponse {
	success: boolean;
	created: UserRow;
}

/**
 * API key in the list
 */
export interface ApiKeyItem {
	id: string;
	label: string;
	scopes: string;
	created_at: number;
	revoked: boolean;
}

/**
 * List of API keys (endpoint /api/admin/api-keys)
 */
export interface ApiKeysListResponse {
	success: boolean;
	keys: ApiKeyItem[];
}

/**
 * API health status (endpoint /api/health)
 */
export interface HealthResponse {
	status: string;
	timestamp?: string;
	database?: string;
}
