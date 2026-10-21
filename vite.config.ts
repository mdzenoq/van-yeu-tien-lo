import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    server: { port: 5173, open: true },
    build: { chunkSizeWarningLimit: 2000 },
    define: {
      __DEBUG__: JSON.stringify(env.DEBUG?.trim().toLowerCase() !== 'false')
    }
  };
});
