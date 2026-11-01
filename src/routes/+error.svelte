<script lang="ts">
  import { page } from '$app/state';
  import { FileQuestion, Lock, TriangleAlert } from '@lucide/svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import { m } from '#lib/paraglide/messages.js';

  // The page the visitor sees for any error SvelteKit raises outside an API route: a titled
  // block and a way home, instead of the bare "404 / Not Found" the framework draws by default.
  const status = $derived(page.status);
  const view = $derived(
    status === 404
      ? { icon: FileQuestion, title: m.err_not_found_title(), desc: m.err_not_found_desc() }
      : status === 401 || status === 403
        ? { icon: Lock, title: m.err_forbidden_title(), desc: m.err_forbidden_desc() }
        : { icon: TriangleAlert, title: m.err_generic_title(), desc: m.err_generic_desc() }
  );
</script>

<svelte:head>
  <title>{status} - MiGallery</title>
</svelte:head>

<div class="error-page">
  <ErrorState icon={view.icon} title="{status} - {view.title}" description={view.desc}>
    <a class="btn" href="/">{m.common_back_home()}</a>
  </ErrorState>
</div>

<style>
  .error-page {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 0 1rem;
  }
</style>
