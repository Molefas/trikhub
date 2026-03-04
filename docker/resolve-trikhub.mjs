/**
 * Custom ESM resolve hook for containerized triks.
 *
 * Problem: Triks mounted at /trik may have broken file: symlinks for
 * @trikhub/* packages in their node_modules (the local paths don't exist
 * inside the container). Additionally, when the SDK is loaded from the
 * container's /trikhub/ directory, its peer dependencies (@langchain/core,
 * zod, etc.) need to resolve from the trik's node_modules, not /trikhub/.
 *
 * Solution:
 * 1. Redirect @trikhub/* imports to the container's installed copies
 * 2. When container SDK code can't find a peer dep, retry from /trik/
 */

export function resolve(specifier, context, nextResolve) {
  // Redirect @trikhub/* imports to container's installed copies
  if (specifier === '@trikhub/sdk') {
    return {
      url: 'file:///trikhub/packages/js/sdk/dist/index.js',
      shortCircuit: true,
    };
  }
  if (specifier === '@trikhub/manifest') {
    return {
      url: 'file:///trikhub/packages/js/manifest/dist/index.js',
      shortCircuit: true,
    };
  }

  // When SDK code (loaded from /trikhub/) imports peer deps like
  // @langchain/core or zod, those aren't in /trikhub/node_modules —
  // they're in the trik's node_modules at /trik/node_modules/.
  // Only redirect bare specifiers (package imports), not relative imports.
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
  if (!isRelative && context.parentURL?.startsWith('file:///trikhub/')) {
    try {
      return nextResolve(specifier, {
        ...context,
        parentURL: 'file:///trik/package.json',
      });
    } catch {
      // Fall through to default resolution
    }
  }

  return nextResolve(specifier, context);
}
