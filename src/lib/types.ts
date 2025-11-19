export interface User {
  id_user: string;
  email: string;
  prenom: string;
  nom: string;
  id_photos?: string | null;
  first_login?: number;
  role?: 'admin' | 'mitviste' | 'user' | string;
  promo_year?: number | null;
}

export interface AlbumRow {
  id: string; // immich UUID
  name: string;
  date?: string | null;
  location?: string | null;
  visibility: 'private' | 'authenticated' | 'unlisted' | string;
  visible?: number | boolean;
}
