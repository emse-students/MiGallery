<script lang="ts">
	import { page } from "$app/state";
	let { children } = $props();

	import { signIn, signOut } from "@auth/sveltekit/client";
</script>

<svelte:head>
    <link rel="icon" type="image/png" sizes="32x32" href="/logo_mitv.32.maskable.png">
	<title>MiGallery</title>
</svelte:head>

<nav>
	<a href="/">Accueil</a>
	<a href="/mes-photos">Mes photos</a>
	<a href="/albums">Albums</a>

	<span style="margin-left:auto">
		{#if page.data?.session?.user}
			<span>{page.data.session.user?.prenom} {page.data.session.user?.nom}</span>
			<button onclick={() => signOut()}>Déconnexion</button>
		{:else}
			<button onclick={() => signIn('cas-emse')}>Connexion</button>
		{/if}
	</span>
</nav>

<main>
	{@render children()}
</main>
