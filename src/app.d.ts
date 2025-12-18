declare global {
	namespace App {
		interface Locals {
			auth?: () => Promise<{
				user?: {
					id?: string;
					preferred_username?: string;
					sub?: string;
					[key: string]: unknown;
				} | null;
			} | null>;
			[key: string]: unknown;
		}
		interface PageData {
			session?: {
				user?: {
					id_user: string;
					email: string;
					prenom: string;
					nom: string;
					id_photos: string | null;
					first_login: number;
					role?: 'admin' | 'mitviste' | 'user';
					promo_year?: number | null;
				} | null;
			};
		}
	}
}

export {};
