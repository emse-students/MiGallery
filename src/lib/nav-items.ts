import type { Component } from 'svelte';
import { Folder, User as UserIcon, Camera, Settings } from '@lucide/svelte';
import { m } from '#lib/paraglide/messages.js';
import type { Locale } from '#lib/paraglide/runtime.js';

/**
 * One destination of the app's main navigation. The phone's bottom bar (`MobileNav`) and the
 * desktop sidebar (`SideNav`) draw the same list, so a page added here reaches both.
 */
export interface NavItem {
  href: string;
  icon: Component;
  /**
   * The destination's full name. A function, not a string: Paraglide resolves the locale at
   * render time. The phone's bar draws no text, so there this is the tab's accessible name only -
   * never let it be empty (pinned in `tests/nav-items.test.ts` for every locale).
   */
  label: (inputs?: Record<string, never>, options?: { locale?: Locale }) => string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/albums', icon: Folder, label: m.nav_albums },
  { href: '/mes-photos', icon: UserIcon, label: m.nav_my_photos },
  { href: '/photos-cv', icon: Camera, label: m.nav_photos_cv },
  { href: '/parametres', icon: Settings, label: m.nav_settings },
];

/**
 * The count the tab of `href` carries (0: no badge). Only "Mes photos" has one: the faces waiting
 * for the member's answer, read from the layout data so that answering on the confirmation screen
 * updates every tab at once (`invalidate('app:face-status')`).
 */
export function navBadgeCount(href: string, faceToConfirm: number | undefined): number {
  if (href !== '/mes-photos') {
    return 0;
  }
  return faceToConfirm !== undefined && faceToConfirm > 0 ? faceToConfirm : 0;
}

/**
 * Whether `href` is the section `pathname` belongs to: `/albums/abc` lights "Albums". A prefix
 * match on a path SEGMENT, so a future `/albums-archive` would not light it.
 */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
