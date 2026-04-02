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
					nom: string;
					id_photos: string | null;
					role?: 'admin' | 'mitviste' | 'user';
					promo_year?: number | null;
				} | null;
			};
		}
	}
}

export {};
