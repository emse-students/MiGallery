<script lang="ts">
	import { onMount } from 'svelte';
	import { Info } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import { toast } from '$lib/toast';

	interface Props {
		show: boolean;
		onComplete: () => void;
	}

	let { show = $bindable(), onComplete }: Props = $props();

	let typedYear = $state<string>('');
	let isStaff = $state<boolean>(false);
	let loading = $state(false);

	async function handleSubmit() {
		let finalYear: number | null = null;

		if (isStaff) {
			finalYear = null;
		} else {
			const yearStr = typedYear.trim();
			if (!yearStr) {
				toast.error('Veuillez renseigner votre année de promotion');
				return;
			}
			const parsed = parseInt(yearStr, 10);
			if (isNaN(parsed) || parsed < 1816 || parsed > new Date().getFullYear() + 10) {
				toast.error('Veuillez entrer une année de promotion valide');
				return;
			}
			finalYear = parsed;
		}

		loading = true;
		try {
			const res = await fetch('/api/users/me/promo', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ promo_year: finalYear })
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
	bind:show
	title="Bienvenue sur MiGallery"
	confirmText="Valider"
	confirmDisabled={loading || (!isStaff && !typedYear.trim())}
	showCloseButton={false}
	onConfirm={handleSubmit}
	onCancel={() => {}}
>
	<div class="first-login-content">
		<p class="welcome-text">
			Pour finaliser votre inscription, veuillez renseigner votre année de promotion :
		</p>

		<div class="year-selector">
			<label for="promoYear">Année de promotion</label>
			<input
				type="number"
				id="promoYear"
				bind:value={typedYear}
				placeholder="Ex: 2024"
				disabled={loading || isStaff}
				class:disabled={isStaff}
			/>
		</div>

		<div class="staff-selector">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={isStaff} disabled={loading} />
				Je suis un membre du personnel de l'École des Mines
			</label>
		</div>

		<p class="info-text">
			<Info size={16} />
			Cette information nous permet de personnaliser votre accès aux albums.
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

	.year-selector input {
		padding: 0.75rem;
		font-size: 1.125rem;
		text-align: center;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-color);
		border-radius: 0.5rem;
		color: var(--text-primary);
	}

	.year-selector input.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.staff-selector {
		display: flex;
		align-items: center;
		margin-top: -0.5rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: 1rem;
		height: 1rem;
		cursor: pointer;
	}

	.info-text {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
		background: var(--bg-tertiary);
		padding: 0.75rem;
		border-radius: 0.5rem;
	}
</style>
