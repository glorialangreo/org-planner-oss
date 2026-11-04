import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist/export',
    lib: { entry: 'src/SnapshotExport.tsx', name: 'SnapshotExport', formats: ['iife'], fileName: () => 'snapshot.js', cssFileName: 'snapshot' },
    sourcemap: false,
  },
});
