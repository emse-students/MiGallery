/**
 * Central icon registry for MiGallery.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Icons were previously imported ad-hoc (`import { Trash2 } from 'lucide-svelte'`)
 * in every component, with no single source of truth. That made it impossible to
 * audit which glyphs the app uses, and it hid a real trap: lucide-svelte 1.0.x
 * renamed/removed several names (e.g. `BarChart2` -> `ChartColumn`,
 * `UploadCloud` -> `CloudUpload`). A wrong name renders an empty `<svg>` that
 * *looks* like a missing icon but is really a bad import.
 *
 * The subtler trap is the opposite: 1.0.x still re-exports 243 DEPRECATED
 * aliases (`AlertCircle`, `CheckCircle`, `XCircle`, `AlertTriangle`,
 * `HelpCircle`...) from `dist/aliases`, so a legacy name renders correctly and
 * nothing warns - until the next major drops them. Canonical names only.
 * `dist/icons/index.js` is the list that counts; `dist/aliases/aliases.js` is
 * the list to stay out of.
 *
 * RULES
 * -----
 * - Import icons from THIS file, not directly from 'lucide-svelte'.
 * - Every name below is verified against node_modules/lucide-svelte/dist/icons/.
 * - Keep it alphabetised within each group. Add new icons here, not inline.
 *
 * All re-exports are tree-shaken by Vite, so this costs nothing at runtime.
 */
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
	Terminal
} from 'lucide-svelte';
