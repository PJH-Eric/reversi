import { bindings, defineConfig, exports as workerExports } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'reversi-backup',
    entrypoint: 'cloudflare/worker.mjs',
    compatibilityDate: '2025-12-01',
    compatibilityFlags: ['nodejs_compat'],
    env: {
      HUB: bindings.durableObject({
        worker: 'reversi-backup',
        exportName: 'ReversiLobby'
      })
    },
    exports: {
      ReversiLobby: workerExports.durableObject({ storage: 'sqlite' })
    }
  }
});
