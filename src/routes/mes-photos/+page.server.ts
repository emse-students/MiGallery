import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '$lib/auth-redirect';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { session } = await parent();
	const user = session?.user;

	// Anonymous: keep the path, the login comes back to it. Logged in without an
	// identity photo: home, where the profile card says what to do next.
	if (!user) {
		throw redirect(303, loginBounceTarget(url.pathname + url.search));
	}

	if (!user.photos_id) {
		throw redirect(303, '/');
	}

	return {};
};
