<script lang="ts">
	import { onMount } from 'svelte';
	import { Info } from 'lucide-svelte';
	import Modal from './Modal.svelte';
	import { toast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		show: boolean;
		onComplete: () => void;
	}

	let { show = $bindable(), onComplete }: Props = $props();

	let typedYear = $state<number | null>(null);
        let isStaff = $state<boolean>(false);
        let loading = $state(false);

        async function handleSubmit() {
                let finalYear: number | null = null;

                if (isStaff) {
                        finalYear = null;
                } else {
                        if (!typedYear) {
                                toast.error(m.flogin_err_promo_required());
                                return;
                        }
						const currentYear = new Date().getFullYear();
						if (typedYear < 1816 || typedYear > currentYear) {
                                toast.error(m.flogin_err_promo_invalid());
                                return;
                        }
                        finalYear = typedYear;
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
				throw new Error(errData.error || m.flogin_err_update());
			}

			toast.success(m.flogin_success());
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
	title={m.home_welcome_title()}
	confirmText={m.common_validate()}
	confirmDisabled={loading || (!isStaff && !typedYear)}
	showCloseButton={false}
	onConfirm={handleSubmit}
	onCancel={() => {}}
>
	<div class="first-login-content">
		<p class="welcome-text">
			{m.flogin_intro()}
		</p>

		<div class="year-selector">
			<label for="promoYear">{m.flogin_promo_label()}</label>
			<input
				type="number"
				id="promoYear"
				bind:value={typedYear}
				min="1816"
				max={new Date().getFullYear()}
				placeholder={m.flogin_promo_placeholder()}
				disabled={loading || isStaff}
				class:disabled={isStaff}
			/>
		</div>

		<div class="staff-selector">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={isStaff} disabled={loading} />
				{m.flogin_staff_label()}
			</label>
		</div>

		<p class="info-text">
			<Info size={16} />
			{m.flogin_info()}
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
		border-radius: var(--radius-xs);
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
		border-radius: var(--radius-xs);
	}
</style>
