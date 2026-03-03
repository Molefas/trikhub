/**
 * Tests for the create-agent template generators.
 *
 * Validates that each provider generates correct imports, packages,
 * env vars, and file structure for both TS and Python targets.
 */
import { describe, it, expect } from 'vitest';

const { generateAgentTypescriptProject } = await import(
  '../../packages/js/cli/dist/templates/agent-typescript.js'
) as typeof import('../../packages/js/cli/src/templates/agent-typescript.js');

const { generateAgentPythonProject } = await import(
  '../../packages/js/cli/dist/templates/agent-python.js'
) as typeof import('../../packages/js/cli/src/templates/agent-python.js');

// ============================================================================
// TypeScript target
// ============================================================================

describe('generateAgentTypescriptProject', () => {
  const providers = ['openai', 'anthropic', 'google'] as const;

  it('generates all expected files', () => {
    const files = generateAgentTypescriptProject({ name: 'my-agent', provider: 'openai' });
    const paths = Object.keys(files);

    expect(paths).toContain('package.json');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('.env.example');
    expect(paths).toContain('.gitignore');
    expect(paths).toContain('.trikhub/config.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/agent.ts');
    expect(paths).toContain('src/cli.ts');
    expect(paths).toHaveLength(8);
  });

  it('generates empty .trikhub/config.json', () => {
    const files = generateAgentTypescriptProject({ name: 'my-agent', provider: 'openai' });
    const config = JSON.parse(files['.trikhub/config.json']);
    expect(config).toEqual({ triks: [] });
  });

  it.each(providers)('generates correct OpenAI imports for provider: %s', (provider) => {
    const files = generateAgentTypescriptProject({ name: 'test-agent', provider });
    const agent = files['src/agent.ts'];

    if (provider === 'openai') {
      expect(agent).toContain("from '@langchain/openai'");
      expect(agent).toContain('ChatOpenAI');
      expect(agent).toContain('gpt-4o-mini');
    } else if (provider === 'anthropic') {
      expect(agent).toContain("from '@langchain/anthropic'");
      expect(agent).toContain('ChatAnthropic');
      expect(agent).toContain('claude-sonnet-4-20250514');
    } else if (provider === 'google') {
      expect(agent).toContain("from '@langchain/google-genai'");
      expect(agent).toContain('ChatGoogleGenerativeAI');
      expect(agent).toContain('gemini-2.0-flash');
    }
  });

  it.each(providers)('generates correct package.json deps for provider: %s', (provider) => {
    const files = generateAgentTypescriptProject({ name: 'test-agent', provider });
    const pkg = JSON.parse(files['package.json']);
    const deps = pkg.dependencies;

    expect(deps['@trikhub/gateway']).toBeDefined();
    expect(deps['dotenv']).toBeDefined();
    expect(deps['@langchain/core']).toBeDefined();
    expect(deps['@langchain/langgraph']).toBeDefined();

    if (provider === 'openai') {
      expect(deps['@langchain/openai']).toBeDefined();
    } else if (provider === 'anthropic') {
      expect(deps['@langchain/anthropic']).toBeDefined();
    } else if (provider === 'google') {
      expect(deps['@langchain/google-genai']).toBeDefined();
    }
  });

  it.each(providers)('generates correct .env.example for provider: %s', (provider) => {
    const files = generateAgentTypescriptProject({ name: 'test-agent', provider });
    const env = files['.env.example'];

    if (provider === 'openai') {
      expect(env).toContain('OPENAI_API_KEY');
    } else if (provider === 'anthropic') {
      expect(env).toContain('ANTHROPIC_API_KEY');
    } else if (provider === 'google') {
      expect(env).toContain('GOOGLE_API_KEY');
    }
  });

  it('uses project name in package.json', () => {
    const files = generateAgentTypescriptProject({ name: 'cool-agent', provider: 'openai' });
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('cool-agent');
  });

  it('includes gateway imports in agent.ts', () => {
    const files = generateAgentTypescriptProject({ name: 'my-agent', provider: 'openai' });
    const agent = files['src/agent.ts'];

    expect(agent).toContain("from '@trikhub/gateway'");
    expect(agent).toContain("from '@trikhub/gateway/langchain'");
    expect(agent).toContain('TrikGateway');
    expect(agent).toContain('enhance');
    expect(agent).toContain('getHandoffToolsForAgent');
    expect(agent).toContain('getExposedToolsForAgent');
  });

  it('includes processMessage in cli.ts', () => {
    const files = generateAgentTypescriptProject({ name: 'my-agent', provider: 'openai' });
    const cli = files['src/cli.ts'];

    expect(cli).toContain('processMessage');
    expect(cli).toContain("import 'dotenv/config'");
    expect(cli).toContain('readline');
  });
});

// ============================================================================
// Python target
// ============================================================================

describe('generateAgentPythonProject', () => {
  const providers = ['openai', 'anthropic', 'google'] as const;

  it('generates all expected files', () => {
    const files = generateAgentPythonProject({ name: 'my-agent', provider: 'openai' });
    const paths = Object.keys(files);

    expect(paths).toContain('pyproject.toml');
    expect(paths).toContain('.env.example');
    expect(paths).toContain('.gitignore');
    expect(paths).toContain('.trikhub/config.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('agent.py');
    expect(paths).toContain('cli.py');
    expect(paths).toHaveLength(7);
  });

  it('generates empty .trikhub/config.json', () => {
    const files = generateAgentPythonProject({ name: 'my-agent', provider: 'openai' });
    const config = JSON.parse(files['.trikhub/config.json']);
    expect(config).toEqual({ triks: [] });
  });

  it.each(providers)('generates correct imports for provider: %s', (provider) => {
    const files = generateAgentPythonProject({ name: 'test-agent', provider });
    const agent = files['agent.py'];

    if (provider === 'openai') {
      expect(agent).toContain('from langchain_openai import ChatOpenAI');
      expect(agent).toContain('gpt-4o-mini');
    } else if (provider === 'anthropic') {
      expect(agent).toContain('from langchain_anthropic import ChatAnthropic');
      expect(agent).toContain('claude-sonnet-4-20250514');
    } else if (provider === 'google') {
      expect(agent).toContain('from langchain_google_genai import ChatGoogleGenerativeAI');
      expect(agent).toContain('gemini-2.0-flash');
    }
  });

  it.each(providers)('generates correct pyproject.toml deps for provider: %s', (provider) => {
    const files = generateAgentPythonProject({ name: 'test-agent', provider });
    const toml = files['pyproject.toml'];

    expect(toml).toContain('trikhub');
    expect(toml).toContain('python-dotenv');
    expect(toml).toContain('langgraph');

    if (provider === 'openai') {
      expect(toml).toContain('langchain-openai');
    } else if (provider === 'anthropic') {
      expect(toml).toContain('langchain-anthropic');
    } else if (provider === 'google') {
      expect(toml).toContain('langchain-google-genai');
    }
  });

  it.each(providers)('generates correct .env.example for provider: %s', (provider) => {
    const files = generateAgentPythonProject({ name: 'test-agent', provider });
    const env = files['.env.example'];

    if (provider === 'openai') {
      expect(env).toContain('OPENAI_API_KEY');
    } else if (provider === 'anthropic') {
      expect(env).toContain('ANTHROPIC_API_KEY');
    } else if (provider === 'google') {
      expect(env).toContain('GOOGLE_API_KEY');
    }
  });

  it('uses project name in pyproject.toml', () => {
    const files = generateAgentPythonProject({ name: 'cool-agent', provider: 'openai' });
    expect(files['pyproject.toml']).toContain('name = "cool-agent"');
  });

  it('includes gateway imports in agent.py', () => {
    const files = generateAgentPythonProject({ name: 'my-agent', provider: 'openai' });
    const agent = files['agent.py'];

    expect(agent).toContain('from trikhub.gateway import TrikGateway');
    expect(agent).toContain('from trikhub.langchain import enhance');
    expect(agent).toContain('get_handoff_tools_for_agent');
    expect(agent).toContain('get_exposed_tools_for_agent');
  });

  it('includes process_message in cli.py', () => {
    const files = generateAgentPythonProject({ name: 'my-agent', provider: 'openai' });
    const cli = files['cli.py'];

    expect(cli).toContain('process_message');
    expect(cli).toContain('from dotenv import load_dotenv');
    expect(cli).toContain('asyncio');
  });
});
