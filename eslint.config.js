import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';

export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	{
		languageOptions: {
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
				project: './tsconfig.json',
				extraFileExtensions: ['.svelte']
			},
			globals: {
				browser: 'readonly',
				node: 'readonly',
				es2022: 'readonly'
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/require-await': 'warn',
			'@typescript-eslint/no-redundant-type-constituents': 'error',
			'no-console': [
				'warn',
				{
					allow: ['warn', 'error', 'debug']
				}
			],
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always'],
			curly: ['error', 'all'],
			'brace-style': ['error', '1tbs'],
			semi: ['error', 'always'],
			quotes: [
				'error',
				'single',
				{
					avoidEscape: true
				}
			],
			indent: ['error', 'tab', { SwitchCase: 1 }],
			'comma-dangle': ['error', 'never'],
			'no-trailing-spaces': 'error',
			'no-multiple-empty-lines': [
				'error',
				{
					max: 2,
					maxEOF: 0
				}
			],
			'object-shorthand': ['error', 'always'],
			'prefer-template': 'error'
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: ts.parser,
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
				project: './tsconfig.json'
			}
		},
		rules: {
			'svelte/prefer-svelte-reactivity': 'off',
			indent: 'off',
			'@typescript-eslint/indent': 'off'
		}
	},
	{
		files: ['scripts/**/*.{js,cjs,mjs}'],
		languageOptions: {
			sourceType: 'module'
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},
	{
		ignores: [
			'build/',
			'dist/',
			'node_modules/',
			'.svelte-kit/',
			'.env*',
			'*.min.*',
			'cookies.txt',
			'svelte.config.js',
			'tailwind.config.cjs',
			'postcss.config.cjs',
			'vitest.config.ts',
			'vite.config.ts',
			'eslint.config.js',
			'scripts/**/*.js',
			'scripts/**/*.cjs',
			'scripts/**/*.mjs',
			'src/**/*.svelte',
			'**/.svelte-kit/**',
			'static/streamsaver-sw.js'
		]
	}
];
