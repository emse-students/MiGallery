import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit()],
    resolve: {
        conditions: ['browser']
    },
    build: {
        minify: 'esbuild',
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                }
            }
        }
    },
    preview: {
        host: '0.0.0.0',                 
        port: 4173,                      
        allowedHosts: ['gallery.mitv.fr']
    }
});
