<script lang="ts">
  import { parseRich, type RichNode } from '#lib/rich-text.ts';

  /**
   * Renders a translation that carries inline markup (`<strong>`, `<em>`, `<br />`, `<a>`) as real
   * elements, without `{@html}`. The allowlist lives in `#lib/rich-text.ts`; a tag it does not know
   * is shown as text, never executed.
   */
  let { text }: { text: string } = $props();

  const nodes = $derived(parseRich(text));
</script>

{#snippet render(list: RichNode[])}
  {#each list as node, i (i)}
    {#if node.kind === 'text'}
      {node.text}
    {:else if node.kind === 'br'}
      <br />
    {:else if node.kind === 'strong'}
      <strong>{@render render(node.children)}</strong>
    {:else if node.kind === 'em'}
      <em>{@render render(node.children)}</em>
    {:else if node.kind === 'span'}
      <span>{@render render(node.children)}</span>
    {:else if node.kind === 'a' && node.external}
      <a class:mail-link={node.mail} href={node.href} target="_blank" rel="noopener noreferrer"
        >{@render render(node.children)}</a
      >
    {:else if node.kind === 'a'}
      <a class:mail-link={node.mail} href={node.href}>{@render render(node.children)}</a>
    {/if}
  {/each}
{/snippet}

{@render render(nodes)}
