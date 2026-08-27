/**
 * Central icon registry for MiGallery.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Icons were previously imported ad-hoc (`import { Trash2 } from '@lucide/svelte'`)
 * in every component, with no single source of truth. That made it impossible to
 * audit which glyphs the app uses, and it hid a real trap: lucide 1.0.x
 * renamed/removed several names (e.g. `BarChart2` -> `ChartColumn`,
 * `UploadCloud` -> `CloudUpload`). A wrong name renders an empty `<svg>` that
 * *looks* like a missing icon but is really a bad import.
 *
 * The subtler trap is the opposite: 1.34.0 still re-exports 254 DEPRECATED
 * aliases (`AlertCircle`, `CheckCircle`, `XCircle`, `AlertTriangle`,
 * `HelpCircle`...) from `dist/aliases`, so a legacy name renders correctly and
 * nothing warns - until the next major drops them. Canonical names only.
 * `dist/icons/index.js` is the list that counts; `dist/aliases/aliases.js` is
 * the list to stay out of.
 *
 * The package itself was renamed: `lucide-svelte` is the deprecated name and
 * `@lucide/svelte` is where releases now land. Both resolve, only one is
 * maintained - never let a stray import reintroduce the old specifier.
 *
 * RULES
 * -----
 * - Import icons from THIS file, not directly from '@lucide/svelte'.
 * - Every name below is verified against node_modules/@lucide/svelte/dist/icons/.
 * - Keep it alphabetised within each group. Add new icons here, not inline.
 *
 * All re-exports are tree-shaken by Vite, so this costs nothing at runtime.
 */
/**
 * The type of an icon component, for every prop that accepts one.
 *
 * Svelte 5 icons are FUNCTION components (`Component<Props>`). These props used to say
 * `ComponentType<SvelteComponent>`, the Svelte 4 CLASS shape, which no lucide icon has
 * satisfied since the package moved to runes - it typechecked only against the legacy
 * shim the old package still carried. Aliased here so the next upstream shape change is
 * one line instead of every call site.
 *
 * Not named `Icon`: the components that consume it already hold a `const Icon`, and an
 * import of that name would conflict with the local declaration.
 */
export type { LucideIcon as IconComponent } from '@lucide/svelte';

export {
  // Navigation / layout
  BookOpen,
  ChevronLeft,
  ChevronRight,
  List,
  // Admin domains (sidebar + page headers)
  Activity, // server health / metrics
  Database, // database maintenance
  Images, // media anomalies
  Key, // API keys
  ScrollText, // logs
  ShieldCheck, // admin brand
  Users, // users management
  UsersRound, // trombinoscope (people grid)
  Webhook, // external API reference
  // Actions
  Book,
  Check,
  CirclePlus,
  CloudUpload,
  FileText,
  FolderPlus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Trash2,
  Wrench,
  // Status / feedback
  ChartColumn,
  CircleAlert,
  Code,
  Film,
  ImageOff,
  Info,
  Layers,
  Lock,
  Terminal,
} from '@lucide/svelte';
