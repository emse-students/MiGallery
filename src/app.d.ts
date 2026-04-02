declare global {
	namespace App {
		interface Locals {
			auth?: () => Promise<{
				user?: {
					id?: string;
					name?: string;
					firstName?: string;
					lastName?: string;
					sub?: string;
					[key: string]: unknown;
				} | null;
			} | null>;
			sessionUser?: {
				id?: string;
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
					nom?: string;
					prenom?: string;
					id_photos?: string | null;
					promo_year?: number | null;
					first_login?: number;
				} | null;
			};
		}
	}
}

export {};
