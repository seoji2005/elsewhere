import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  // es2022: top-level await (iOS Safari 15+)
  build: { target: 'es2022', outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
