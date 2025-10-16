<script lang="ts">
	import { page } from "$app/state";
	let { children } = $props();

	import { signIn, signOut } from "@auth/sveltekit/client";
</script>

<svelte:head>
	<title>MiGallery (minimal)</title>
</svelte:head>

<nav>
	<a href="/">Accueil</a>
	<a href="/mes-photos">Mes photos</a>
	<a href="/albums">Albums</a>

	<span style="margin-left:auto">
		{#if page.data?.session?.user}
			<span>{page.data.session.user?.name ?? page.data.session.user.email}</span>
			<button onclick={() => signOut()}>Déconnexion</button>
		{:else}
			<button onclick={() => signIn('cas-emse')}>Connexion</button>
		{/if}
	</span>
</nav>

<main>
	{@render children()}
</main>
