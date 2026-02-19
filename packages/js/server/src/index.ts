/**
 * @trikhub/server - HTTP server for TrikHub skill execution
 *
 * @example
 * ```typescript
 * import { TrikServer } from '@trikhub/server';
 *
 * const server = new TrikServer({
 *   configPath: '.trikhub/config.json',
 *   port: 3000,
 * });
 *
 * server.registerSignalHandlers();
 * await server.run();
 * ```
 */

// Main server class
export { TrikServer, type TrikServerOptions, type ServerState } from './trik-server.js';

// Low-level building blocks (for advanced use cases)
export { createServer } from './server.js';
export { loadConfig, type ServerConfig } from './config.js';
export { SkillLoader, type SkillLoaderConfig, type LoadResult } from './services/skill-loader.js';
