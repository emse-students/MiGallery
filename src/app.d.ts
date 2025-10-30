// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			session?: {
				user?: {
					id_user: string;
					email: string;
					prenom: string;
					nom: string;
					id_photos: string | null;
					first_login: number;
				} | null;
			};
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
