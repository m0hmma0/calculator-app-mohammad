import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
};

// `preview` mode emits one self-contained HTML file so a phase can be published
// as an artifact and clicked through without any backend. `npm run build:preview`.
export default defineConfig(({ mode }) => {
  const singleFile = mode === 'preview';

  return {
    plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
    resolve: { alias },
    build: singleFile
      ? {
          outDir: 'dist-preview',
          emptyOutDir: true,
          cssCodeSplit: false,
          assetsInlineLimit: Infinity,
        }
      : { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  };
});
