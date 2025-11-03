<script lang="ts">
	import { page } from "$app/state";
	import { signIn, signOut } from "@auth/sveltekit/client";
	import "../app.css";

	let u: any = null;
	$: u = (page.data?.session?.user) as any;
</script>

<svelte:head>
	<link rel="icon" type="image/png" sizes="32x32" href="/MiGallery.png">
	<title>MiGallery</title>
</svelte:head>

<nav class="topbar">
	<div class="brand">
		<img src="/MiGallery.png" alt="MiGallery" class="logo" />
		<a href="/">MiGallery</a>
	</div>

	<div class="links">
		<a href="/mes-photos">Mes photos</a>
		<a href="/albums">Albums</a>
		<a href="/parametres">Paramètres</a>
	</div>

	<div class="user">
		{#if u}
			<div class="avatar" title={`${u.prenom || ''} ${u.nom || ''}`}>
				{#if u.id_photos}
					<img src={`/api/immich/people/${u.id_photos}/thumbnail?t=${Date.now()}`} alt="avatar" onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
				{:else}
					<span class="initials">{(u.prenom || 'U').charAt(0)}{(u.nom || '').charAt(0) || 'U'}</span>
				{/if}
			</div>
			<span class="user-name">{u.prenom} {u.nom}</span>
			<button class="btn-logout" onclick={() => signOut()}>Déconnexion</button>
		{:else}
			<button class="btn-login" onclick={() => signIn('cas-emse')}>Connexion</button>
		{/if}
	</div>
</nav>

<main>
	<slot />
</main>

