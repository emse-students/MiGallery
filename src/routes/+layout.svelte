<script lang="ts">
	import { page } from "$app/state";
	import { signIn, signOut } from "@auth/sveltekit/client";

	// user shortcut for template usage
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
					<!-- Use the same people endpoints as other pages (thumbnail is lighter) -->
					<img src={`/api/immich/people/${u.id_photos}/thumbnail?t=${Date.now()}`} alt="avatar" onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
				{:else}
					<span class="initials">{(u.prenom || 'U').charAt(0)}{(u.nom || '').charAt(0) || 'U'}</span>
				{/if}
			</div>
			<div class="user-info">
				<div class="user-name">{u.prenom} {u.nom}</div>
				<button class="btn-logout" onclick={() => signOut()}>Déconnexion</button>
			</div>
		{:else}
			<button class="btn-login" onclick={() => signIn('cas-emse')}>Connexion</button>
		{/if}
	</div>
</nav>

<style>
	.topbar{
		display:flex;align-items:center;gap:16px;padding:12px 20px;background:#fff;border-bottom:1px solid #eee;
	}
	.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:#2c3e50}
	.brand .logo{width:36px;height:36px;border-radius:6px}
	.links{display:flex;gap:12px;margin-left:16px}
	.links a{color:#2c3e50;text-decoration:none;padding:6px 10px;border-radius:6px}
	.links a:hover{background:#f5f7fa}
	.user{margin-left:auto;display:flex;align-items:center;gap:12px}
	.avatar{width:44px;height:44px;border-radius:50%;background:#dfe6ee;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
	.avatar img{width:100%;height:100%;object-fit:cover;display:block}
	.avatar .initials{position:absolute;font-weight:700;color:#2c3e50}
	.user-info{display:flex;flex-direction:column;align-items:flex-end}
	.user-name{font-size:0.95em;color:#2c3e50}
	.btn-logout,.btn-login{background:#3498db;color:white;border:none;padding:8px 10px;border-radius:6px;cursor:pointer}
	.btn-logout:hover,.btn-login:hover{background:#2980b9}
</style>

<main>
	<slot />
</main>
