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
	RefreshCw,
	RotateCcw,
	Trash2,
	Wrench,
	// Status / feedback
	AlertCircle,
	ChartColumn,
	Code,
	Info,
	Lock,
	Terminal
} from 'lucide-svelte';
