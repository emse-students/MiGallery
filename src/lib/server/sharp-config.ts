/**
 * Configuration globale de Sharp / libvips (serveur uniquement).
 *
 * Sharp s'appuie sur libvips (mémoire native, comptabilisée dans `external`).
 * Par défaut libvips garde un cache d'opérations et lance autant de threads que
 * de cœurs CPU — la mémoire native libérée n'est de plus pas rendue à l'OS sous
 * glibc (fragmentation d'arènes). Sur un proxy qui génère beaucoup de vignettes,
 * cela fait grimper puis stagner la RSS.
 *
 * Ce module est importé une seule fois (idempotent) partout où l'on utilise
 * Sharp, pour appliquer des réglages sobres :
 *  - `cache(false)`   : pas de rétention native entre requêtes ;
 *  - `concurrency(2)` : borne les threads/pools par opération.
 *
 * À compléter côté déploiement par `MALLOC_ARENA_MAX=2` pour limiter la
 * fragmentation glibc des allocations libvips.
 */
import sharp from 'sharp';

// Un module ES n'est évalué qu'une fois : ces réglages s'appliquent une seule
// fois au premier import, quel que soit le nombre de fichiers qui l'importent.
sharp.cache(false);
sharp.concurrency(2);

export default sharp;
