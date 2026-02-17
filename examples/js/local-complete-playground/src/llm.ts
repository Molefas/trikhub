export type LLMProvider = 'openai' | 'anthropic' | 'google';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-1.5-flash',
};

function detectProvider(): LLMProvider {
  // Check for explicit provider setting
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === 'openai' || explicit === 'anthropic' || explicit === 'google') {
    return explicit;
  }

  // Auto-detect based on available API keys
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GOOGLE_API_KEY) return 'google';
  if (process.env.OPENAI_API_KEY) return 'openai';

  // Default to OpenAI
  return 'openai';
}

export function getDefaultConfig(): LLMConfig {
  const provider = detectProvider();
  return {
    provider,
    model: process.env.LLM_MODEL || DEFAULT_MODELS[provider],
    temperature: 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createLLM(config?: Partial<LLMConfig>): Promise<any> {
  const finalConfig = { ...getDefaultConfig(), ...config };
  const { provider, model, temperature } = finalConfig;

  switch (provider) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return new ChatOpenAI({ model, temperature });
    }
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return new ChatAnthropic({ model, temperature });
    }
    case 'google': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      return new ChatGoogleGenerativeAI({ model, temperature });
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export function getProviderInfo(): { provider: LLMProvider; model: string; hasKey: boolean } {
  const config = getDefaultConfig();
  const hasKey = !!getApiKey(config.provider);
  return { provider: config.provider, model: config.model, hasKey };
}

function getApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'google':
      return process.env.GOOGLE_API_KEY;
  }
}
