import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Cloud preview hostname changes per session, so only the one this process
// was started with is allowed — never a wildcard.
const previewHost = process.env.VITE_PREVIEW_HOST

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: { port: 5173, strictPort: false, allowedHosts: previewHost ? [previewHost] : undefined },
})
