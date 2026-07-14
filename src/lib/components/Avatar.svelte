<script lang="ts">
	// Reusable person avatar: shows the user's profile face (served by
	// /api/users/{id}/avatar) and falls back to initials on a missing photo.
	interface Props {
		userId?: string | null;
		firstName?: string | null;
		lastName?: string | null;
		name?: string | null;
		size?: number;
		/** Backing asset id (photos_asset_id): busts the cache when the photo changes. */
		version?: string | null;
	}

	let {
		userId = null,
		firstName = null,
		lastName = null,
		name = null,
		size = 40,
		version = null
	}: Props = $props();

	let failed = $state(false);

	function initials(first: string | null, last: string | null, full: string | null): string {
		const f = (first || '').trim();
		const l = (last || '').trim();
		if (f || l) return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase() || '?';
		const parts = (full || '').trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
	}

	const label = $derived(initials(firstName, lastName, name));
	const src = $derived(
		userId
			? `/api/users/${encodeURIComponent(userId)}/avatar${version ? `?v=${encodeURIComponent(version)}` : ''}`
			: null
	);
</script>

<div class="avatar" style="--sz: {size}px" title={name ?? ''}>
	{#if src && !failed}
		<img {src} alt={name ?? 'avatar'} loading="lazy" onerror={() => (failed = true)} />
	{:else}
		<span class="initials">{label}</span>
	{/if}
</div>

<style>
	.avatar {
		width: var(--sz);
		height: var(--sz);
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--gradient-purple-pink);
		color: #fff;
		font-weight: 700;
		line-height: 1;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.initials {
		font-size: calc(var(--sz) * 0.4);
		letter-spacing: 0.02em;
	}
</style>
