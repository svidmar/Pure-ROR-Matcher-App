import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // anything starting with /ws/api is forwarded to Pure
      // Update the target to match your Pure instance URL
      '/ws/api': {
        target: 'https://your-institution.pure.elsevier.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
