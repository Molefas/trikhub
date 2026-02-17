/**
 * TrikHub CLI Library Exports
 *
 * These exports can be used programmatically.
 */

// Types
export * from './types.js';

// Storage utilities
export {
  loadConfig,
  saveConfig,
  loadLockfile,
  saveLockfile,
  getInstalledTriks,
  getInstalledTrik,
  isTrikInstalled,
  getTrikPath,
  TRIKHUB_DIR,
  TRIKS_DIR,
  CONFIG_PATH,
  LOCKFILE_PATH,
} from './lib/storage.js';

// Registry client
export { RegistryClient, registry } from './lib/registry.js';

// Commands (for programmatic use)
export { syncCommand } from './commands/sync.js';
