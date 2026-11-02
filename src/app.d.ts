import type { SessionUser } from '#lib/auth.ts';
import type { FirstPaint } from '#lib/first-paint.ts';

declare global {
  /** package.json version, injected by vite.config.ts `define`. */
  const __APP_VERSION__: string;

  namespace App {
    interface Locals {
      user?: SessionUser | null;
      [key: string]: unknown;
    }
    interface PageData {
      session?: {
        user?: {
          id_user: string;
          name: string;
          first_name?: string | null;
          last_name?: string | null;
          formation?: string | null;
          /** Face matching is on for them: enrolled, or holding photos (lot A6). */
          face_enrolled: boolean;
          photos_asset_id?: string | null;
          role?: 'admin' | 'mitviste' | 'user';
          promo?: number | null;
        } | null;
      } | null;
      /**
       * The faces waiting for the member's answer (the badge on "Mes photos" and its banner).
       * Refreshed by `invalidate('app:face-status')` after each answer.
       */
      faceToConfirm?: number;
      /** Set by the root layout on every page: see `#lib/first-paint.ts`. */
      firstPaint: FirstPaint;
    }
  }
}

export {};
