/**
 * Post-login destination sanitizing (`src/lib/auth-redirect.ts`).
 *
 * Pure functions, no server needed: this runs under `npm run test:unit`. What
 * it pins is the refusal list - every entry here is a value a browser can hand
 * us, and each one leaves the site or loops the login if it is trusted.
 */

import { describe, it, expect } from 'vitest';
import { loginBounceTarget, loginUrlWithRedirect, safeRedirectTarget } from '$lib/auth-redirect';

describe('safeRedirectTarget', () => {
	it('accepts an in-app path, query and hash included', () => {
		expect(safeRedirectTarget('/albums/abc')).toBe('/albums/abc');
		expect(safeRedirectTarget('/albums/abc?tri=date#photo-3')).toBe('/albums/abc?tri=date#photo-3');
		expect(safeRedirectTarget('/parametres')).toBe('/parametres');
	});

	it('rejects anything that leaves the site', () => {
		// Both of these start with '/' - a naive startsWith check lets them through.
		expect(safeRedirectTarget('//evil.com')).toBeNull();
		expect(safeRedirectTarget('/\\evil.com')).toBeNull();
		expect(safeRedirectTarget('https://evil.com')).toBeNull();
		expect(safeRedirectTarget('evil.com')).toBeNull();
		expect(safeRedirectTarget('javascript:alert(1)')).toBeNull();
	});

	it('rejects control characters', () => {
		expect(safeRedirectTarget('/albums\r\nSet-Cookie: a=b')).toBeNull();
		expect(safeRedirectTarget('/albums\u0000')).toBeNull();
	});

	it('rejects the destinations that would loop or say nothing', () => {
		expect(safeRedirectTarget('/')).toBeNull();
		expect(safeRedirectTarget('/api/auth/login')).toBeNull();
		expect(safeRedirectTarget('/api/auth/callback?code=x')).toBeNull();
	});

	it('rejects empty input', () => {
		expect(safeRedirectTarget('')).toBeNull();
		expect(safeRedirectTarget(null)).toBeNull();
		expect(safeRedirectTarget(undefined)).toBeNull();
	});
});

describe('loginBounceTarget', () => {
	it('carries the path to the home page, encoded', () => {
		expect(loginBounceTarget('/albums/abc')).toBe('/?redirectTo=%2Falbums%2Fabc');
		expect(loginBounceTarget('/albums/abc?tri=date')).toBe(
			'/?redirectTo=%2Falbums%2Fabc%3Ftri%3Ddate'
		);
	});

	it('falls back to the bare home page for every refused value', () => {
		for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/api/auth/login', '/', '']) {
			expect(loginBounceTarget(bad)).toBe('/');
		}
	});
});

describe('loginUrlWithRedirect', () => {
	it('carries the destination to the login route', () => {
		expect(loginUrlWithRedirect('/albums/abc')).toBe('/api/auth/login?redirectTo=%2Falbums%2Fabc');
	});

	it('starts a plain login for every refused value', () => {
		expect(loginUrlWithRedirect('//evil.com')).toBe('/api/auth/login');
		expect(loginUrlWithRedirect(null)).toBe('/api/auth/login');
	});
});
