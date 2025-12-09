<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { toast } from '$lib/toast';

	interface Props {
		show: boolean;
		onComplete: () => void;
	}

	let { show = $bindable(), onComplete }: Props = $props();

	let selectedYear = $state(new Date().getFullYear());
	let loading = $state(false);
	let years = $state<number[]>([]);

	onMount(() => {
		// Générer une liste d'années (année actuelle jusqu'à 10 ans en arrière)
		const currentYear = new Date().getFullYear();
		const yearList: number[] = [];
		for (let i = 0; i < 10; i++) {
			yearList.push(currentYear - i);
		}
		years = yearList;
		selectedYear = currentYear;
	});

	async function handleSubmit() {
		if (!selectedYear) {
			toast.error('Veuillez sélectionner une année de promotion');
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/users/me/promo', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ promo_year: selectedYear })
			});

			if (!res.ok) {
				const errData = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errData.error || 'Erreur lors de la mise à jour');
			}

			toast.success('Bienvenue ! Votre profil a été configuré.');
			show = false;
			onComplete();
		} catch (e: unknown) {
			toast.error((e as Error).message);
		} finally {
			loading = false;
		}
	}
</script>

<Modal
	bind:show={show}
	title="Bienvenue sur MiGallery ! 👋"
	icon="user-check"
	confirmText="Valider"
	confirmDisabled={loading}
	showCloseButton={false}
	onConfirm={handleSubmit}
	onCancel={() => {}}
>
	<div class="first-login-content">
		<p class="welcome-text">
			Pour finaliser votre inscription, veuillez sélectionner votre année de promotion :
		</p>

		<div class="year-selector">
			<label for="promoYear">Année de promotion</label>
			<select id="promoYear" bind:value={selectedYear} disabled={loading}>
				{#each years as year}
					<option value={year}>{year}</option>
				{/each}
			</select>
		</div>

		<p class="info-text">
			<Icon name="info" size={16} />
			Cette information nous permet de personnaliser votre accès aux albums et au trombinoscope.
		</p>
	</div>
</Modal>

<style>
	.first-login-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 0.5rem 0;
	}

	.welcome-text {
		font-size: 1rem;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.6;
	}

	.year-selector {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.year-selector label {
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
	}

	.year-selector select {
		padding: 0.75rem;
		font-size: 1.125rem;
		font-weight: 500;
		text-align: center;
		background: var(--bg-tertiary);
		border: 2px solid var(--border);
		border-radius: 8px;
		color: var(--text-primary);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.year-selector select:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.year-selector select:focus {
		outline: none;
		border-color: var(--accent);
		background: var(--bg-quaternary);
	}

	.year-selector select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.info-text {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border-radius: 6px;
		line-height: 1.5;
	}
</style>
