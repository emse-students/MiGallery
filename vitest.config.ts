import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		passWithNoTests: true,
		testTimeout: 30000, // 30 secondes pour les tests d'API
		hookTimeout: 30000, // 30 secondes pour les hooks (setup/teardown)
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		// Exécution séquentielle pour éviter les conflits de ressources
		sequence: {
			concurrent: false
		},
		// Exécuter les fichiers de test en série (pas en parallèle)
		fileParallelism: false,
		// Retry pour les tests flaky (notamment ceux dépendant d'Immich)
		retry: 1,
		// Reporter compact : affiche uniquement le résumé
		reporters: [['default', { summary: true }]],
		// Désactiver les logs stdout/stderr des tests
		silent: true,
		// Désactiver les logs console.log/error dans les tests
		onConsoleLog() {
			return false; // Masquer tous les logs console
		},
		// Coverage configuration
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts', '**/*.config.ts']
		}
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	}
});
