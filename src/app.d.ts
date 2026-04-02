declare global {
	namespace App {
		interface Locals {
			user?: {
				id?: string;
				id_user?: string;
				name?: string;
				role?: string;
				[key: string]: unknown;
			} | null;
			[key: string]: unknown;
		}
		interface PageData {
			session?: {
				user?: {
					id_user: string;
					name: string;
					first_name?: string | null;
					last_name?: string | null;
					photos_id: string | null;
					role?: 'admin' | 'mitviste' | 'user';
					promo?: number | null;
					id_photos?: string | null;
					promo_year?: number | null;
					first_login?: number;
				} | null;
			} | null;
		}
	}
}

export {};
