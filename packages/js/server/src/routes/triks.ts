import type { FastifyInstance } from 'fastify';
import type { TrikGateway } from '@trikhub/gateway';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execAsync = promisify(exec);

interface InstallRequest {
  package: string;
}

interface InstallResponse {
  success: boolean;
  message: string;
  package?: string;
  error?: string;
}

interface TrikListItem {
  name: string;
  version?: string;
}

interface ListResponse {
  triks: TrikListItem[];
}

interface UninstallResponse {
  success: boolean;
  message: string;
  error?: string;
}

interface ReloadResponse {
  success: boolean;
  message: string;
  loaded: number;
}

const installRequestSchema = {
  type: 'object',
  required: ['package'],
  properties: {
    package: { type: 'string', description: 'Package name to install (e.g., @molefas/article-search)' },
  },
} as const;

const installResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    package: { type: 'string' },
    error: { type: 'string' },
  },
} as const;

const listResponseSchema = {
  type: 'object',
  properties: {
    triks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
        },
      },
    },
  },
} as const;

const reloadResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    loaded: { type: 'number' },
  },
} as const;

export async function triksRoutes(
  fastify: FastifyInstance,
  gateway: TrikGateway,
  configPath?: string,
  baseDir?: string
): Promise<void> {
  // List installed triks
  fastify.get<{ Reply: ListResponse }>(
    '/api/v1/triks',
    {
      schema: {
        tags: ['triks'],
        summary: 'List installed triks',
        description: 'Returns all triks installed via the CLI',
        response: {
          200: listResponseSchema,
        },
      },
    },
    async () => {
      const triks: TrikListItem[] = [];

      if (configPath) {
        try {
          const configContent = await readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          if (Array.isArray(config.triks)) {
            for (const name of config.triks) {
              triks.push({ name });
            }
          }
        } catch {
          // Config file doesn't exist or is invalid
        }
      }

      return { triks };
    }
  );

  // Install a trik
  fastify.post<{ Body: InstallRequest; Reply: InstallResponse }>(
    '/api/v1/triks/install',
    {
      schema: {
        tags: ['triks'],
        summary: 'Install a trik',
        description: 'Installs a trik package using the trik CLI',
        body: installRequestSchema,
        response: {
          200: installResponseSchema,
          500: installResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { package: packageName } = request.body;

      if (!packageName || typeof packageName !== 'string') {
        return reply.status(400).send({
          success: false,
          message: 'Invalid package name',
          error: 'Package name is required',
        });
      }

      // Validate package name (basic sanitization)
      if (!/^[@a-z0-9][\w\-./]*$/i.test(packageName)) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid package name format',
          error: 'Package name contains invalid characters',
        });
      }

      try {
        // Run trik install command
        const { stdout, stderr } = await execAsync(`trik install ${packageName}`, {
          timeout: 120000, // 2 minute timeout
          cwd: '/app',
        });

        fastify.log.info({ stdout, stderr }, `Installed trik: ${packageName}`);

        // Reload skills after install
        // baseDir must be /app (or /data) where package.json and node_modules live,
        // not dirname(configPath) which would be /data/.trikhub/
        if (configPath) {
          await gateway.loadTriksFromConfig({ configPath, baseDir });
        }

        return {
          success: true,
          message: `Successfully installed ${packageName}`,
          package: packageName,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error({ error }, `Failed to install trik: ${packageName}`);

        return reply.status(500).send({
          success: false,
          message: `Failed to install ${packageName}`,
          error: errorMessage,
        });
      }
    }
  );

  // Uninstall a trik
  fastify.delete<{ Params: { name: string }; Reply: UninstallResponse }>(
    '/api/v1/triks/:name',
    {
      schema: {
        tags: ['triks'],
        summary: 'Uninstall a trik',
        description: 'Uninstalls a trik package using the trik CLI',
        params: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Package name to uninstall' },
          },
        },
        response: {
          200: installResponseSchema,
          500: installResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params;

      try {
        const { stdout, stderr } = await execAsync(`trik uninstall ${name}`, {
          timeout: 60000,
          cwd: '/app',
        });

        fastify.log.info({ stdout, stderr }, `Uninstalled trik: ${name}`);

        // Reload skills after uninstall
        if (configPath) {
          await gateway.loadTriksFromConfig({ configPath, baseDir });
        }

        return {
          success: true,
          message: `Successfully uninstalled ${name}`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error({ error }, `Failed to uninstall trik: ${name}`);

        return reply.status(500).send({
          success: false,
          message: `Failed to uninstall ${name}`,
          error: errorMessage,
        });
      }
    }
  );

  // Reload skills
  fastify.post<{ Reply: ReloadResponse }>(
    '/api/v1/triks/reload',
    {
      schema: {
        tags: ['triks'],
        summary: 'Reload skills',
        description: 'Reloads all skills from the config without restarting the server',
        response: {
          200: reloadResponseSchema,
          500: reloadResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        let loaded = 0;

        if (configPath) {
          const manifests = await gateway.loadTriksFromConfig({ configPath, baseDir });
          loaded = manifests.length;
        }

        return {
          success: true,
          message: `Reloaded ${loaded} triks`,
          loaded,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error({ error }, 'Failed to reload triks');

        return reply.status(500).send({
          success: false,
          message: 'Failed to reload triks',
          loaded: 0,
        });
      }
    }
  );
}
