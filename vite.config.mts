import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'

// Inject version so the React frontend can read it via import.meta.env.VITE_APP_VERSION
process.env.VITE_APP_VERSION = version;

const productionCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://apiteamsync.duckdns.org wss://apiteamsync.duckdns.org https://generativelanguage.googleapis.com https://api.groq.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
].join('; ');

const developmentCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "img-src 'self' data: https:",
    "connect-src 'self' http://localhost:3456 ws://localhost:3456 http://localhost:5180 ws://localhost:5180 https://apiteamsync.duckdns.org wss://apiteamsync.duckdns.org https://generativelanguage.googleapis.com https://api.groq.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
].join('; ');

function teamSyncCspPlugin() {
    return {
        name: 'teamsync-csp',
        transformIndexHtml(html: string, ctx: { server?: unknown }) {
            const csp = ctx.server ? developmentCsp : productionCsp;
            return html.replace('%TEAMSYNC_CSP%', csp);
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), teamSyncCspPlugin()],
    base: './', // Use relative paths for Electron
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@hooks": path.resolve(__dirname, "./src/hooks"),
            "@config": path.resolve(__dirname, "./src/config"),
        },
    },
    server: {
        port: 5180,
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'framer-motion'],
                    ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-toast']
                }
            }
        }
    }
})
