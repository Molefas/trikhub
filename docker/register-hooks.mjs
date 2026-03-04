/**
 * Registers the custom ESM resolve hook for @trikhub/* packages.
 * Used via: node --import /trikhub/register-hooks.mjs
 */
import { register } from 'node:module';
register(new URL('./resolve-trikhub.mjs', import.meta.url));
