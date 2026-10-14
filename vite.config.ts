import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  // worktrees symlink node_modules; keep the cache writable inside the tree
  cacheDir: '.vite-cache',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  // es2022: top-level await (iOS Safari 15+)
  build: { target: 'es2022', outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
