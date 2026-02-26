/**
 * analyze_trik_requirements — v2 implementation.
 *
 * Analyzes a user description and suggests v2 trik architecture:
 * agent mode, handoff description, domain tags, and internal tools.
 */

import type { AnalyzeResult } from './types.js';

// ============================================================================
// Keyword sets for heuristic analysis
// ============================================================================

const CONVERSATIONAL_KEYWORDS = [
  'conversation', 'chat', 'discuss', 'multi-turn', 'follow-up', 'agent',
  'interactive', 'reasoning', 'think', 'decide', 'help me', 'assist',
  'advise', 'recommend', 'explore', 'brainstorm', 'collaborate',
  'llm', 'ai', 'generate', 'create content', 'write', 'draft',
];

const TOOL_MODE_KEYWORDS = [
  'convert', 'transform', 'format', 'calculate', 'compute', 'validate',
  'check', 'lint', 'parse', 'encode', 'decode', 'deterministic',
  'no llm', 'simple', 'tool mode', 'single request', 'lookup',
  'native tool', 'api', 'fetch', 'weather', 'data lookup',
];

const PYTHON_KEYWORDS = [
  'python', 'pip', 'pypi', 'django', 'flask', 'fastapi', 'pandas',
  'numpy', 'scipy', 'pytorch', 'tensorflow', 'pydantic', 'asyncio',
  'langchain python', 'python sdk', '.py',
];

const TYPESCRIPT_KEYWORDS = [
  'typescript', 'javascript', 'node', 'npm', 'deno', 'bun', 'react',
  'next.js', 'express', 'nestjs', 'zod', 'prisma', '.ts', '.js',
];

const STORAGE_KEYWORDS = [
  'remember', 'save', 'store', 'persist', 'history', 'cache', 'track',
  'log', 'bookmark', 'favorite', 'preference', 'database', 'data',
  'across sessions', 'persistent',
];

const SESSION_KEYWORDS = [
  'conversation', 'context', 'follow-up', 'reference', 'previous',
  'earlier', 'multi-turn', 'session', 'stateful',
];

/** Maps API name mentions to config keys */
const API_CONFIG_MAP: Record<string, { key: string; description: string }> = {
  'github': { key: 'GITHUB_TOKEN', description: 'GitHub personal access token' },
  'twitter': { key: 'TWITTER_API_KEY', description: 'Twitter/X API key' },
  'openai': { key: 'OPENAI_API_KEY', description: 'OpenAI API key' },
  'anthropic': { key: 'ANTHROPIC_API_KEY', description: 'Anthropic API key' },
  'slack': { key: 'SLACK_TOKEN', description: 'Slack bot token' },
  'discord': { key: 'DISCORD_TOKEN', description: 'Discord bot token' },
  'stripe': { key: 'STRIPE_API_KEY', description: 'Stripe API key' },
  'notion': { key: 'NOTION_API_KEY', description: 'Notion API key' },
  'google': { key: 'GOOGLE_API_KEY', description: 'Google API key' },
  'spotify': { key: 'SPOTIFY_CLIENT_ID', description: 'Spotify client ID' },
  'jira': { key: 'JIRA_API_TOKEN', description: 'Jira API token' },
  'linear': { key: 'LINEAR_API_KEY', description: 'Linear API key' },
};

/** Verb → tool pattern mapping */
const TOOL_PATTERNS: Array<{
  verbs: string[];
  namePrefix: string;
  hasLogTemplate: boolean;
}> = [
  { verbs: ['search', 'find', 'query', 'look up', 'lookup'], namePrefix: 'search', hasLogTemplate: true },
  { verbs: ['create', 'add', 'new', 'insert', 'generate'], namePrefix: 'create', hasLogTemplate: true },
  { verbs: ['update', 'edit', 'modify', 'change', 'revise'], namePrefix: 'update', hasLogTemplate: true },
  { verbs: ['delete', 'remove', 'clear'], namePrefix: 'delete', hasLogTemplate: true },
  { verbs: ['list', 'show', 'display', 'get all'], namePrefix: 'list', hasLogTemplate: false },
  { verbs: ['fetch', 'download', 'pull', 'import', 'sync'], namePrefix: 'fetch', hasLogTemplate: true },
  { verbs: ['analyze', 'summarize', 'review', 'assess'], namePrefix: 'analyze', hasLogTemplate: true },
  { verbs: ['publish', 'deploy', 'send', 'push', 'export'], namePrefix: 'publish', hasLogTemplate: true },
  { verbs: ['convert', 'transform', 'format'], namePrefix: 'convert', hasLogTemplate: true },
];

// ============================================================================
// Analysis logic
// ============================================================================

function countKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function extractDomainTags(description: string): string[] {
  const lower = description.toLowerCase();
  const tags: string[] = [];

  const domainPatterns: Array<{ keywords: string[]; tag: string }> = [
    { keywords: ['content', 'article', 'blog', 'post', 'writing'], tag: 'content management' },
    { keywords: ['code', 'programming', 'developer', 'software', 'git'], tag: 'software development' },
    { keywords: ['data', 'analytics', 'metrics', 'statistics', 'dashboard'], tag: 'data analysis' },
    { keywords: ['email', 'message', 'notification', 'communication'], tag: 'communication' },
    { keywords: ['file', 'document', 'pdf', 'image', 'media'], tag: 'file management' },
    { keywords: ['calendar', 'schedule', 'meeting', 'event', 'time'], tag: 'scheduling' },
    { keywords: ['finance', 'money', 'payment', 'invoice', 'budget'], tag: 'finance' },
    { keywords: ['project', 'task', 'todo', 'kanban', 'workflow'], tag: 'project management' },
    { keywords: ['search', 'find', 'query', 'index'], tag: 'search' },
    { keywords: ['api', 'integration', 'webhook', 'connect'], tag: 'integrations' },
    { keywords: ['rss', 'feed', 'news', 'curate', 'aggregate'], tag: 'content curation' },
    { keywords: ['ai', 'machine learning', 'model', 'generate'], tag: 'AI generation' },
    { keywords: ['social media', 'twitter', 'linkedin', 'social'], tag: 'social media' },
    { keywords: ['database', 'sql', 'store', 'persist'], tag: 'data storage' },
  ];

  for (const { keywords, tag } of domainPatterns) {
    if (keywords.some((kw) => lower.includes(kw))) {
      tags.push(tag);
    }
  }

  return tags.length > 0 ? tags : ['general purpose'];
}

function extractTools(description: string): AnalyzeResult['suggestedTools'] {
  const lower = description.toLowerCase();
  const tools: AnalyzeResult['suggestedTools'] = [];

  for (const pattern of TOOL_PATTERNS) {
    const matchedVerb = pattern.verbs.find((v) => lower.includes(v));
    if (matchedVerb) {
      // Try to extract the object of the verb
      const regex = new RegExp(`${matchedVerb}\\s+(?:the\\s+)?(?:a\\s+)?(\\w+)`, 'i');
      const match = description.match(regex);
      const object = match?.[1] || 'items';
      const toolName = `${pattern.namePrefix}${object.charAt(0).toUpperCase() + object.slice(1)}`;

      tools.push({
        name: toolName,
        description: `${matchedVerb.charAt(0).toUpperCase() + matchedVerb.slice(1)} ${object}`,
        hasLogTemplate: pattern.hasLogTemplate,
      });
    }
  }

  return tools;
}

function extractConfigRequirements(
  description: string,
  constraints?: string,
): Array<{ key: string; description: string }> {
  const text = `${description} ${constraints || ''}`.toLowerCase();
  const configs: Array<{ key: string; description: string }> = [];

  for (const [apiName, config] of Object.entries(API_CONFIG_MAP)) {
    if (text.includes(apiName)) {
      configs.push(config);
    }
  }

  return configs;
}

function generateHandoffDescription(description: string): string {
  // Trim to a reasonable length for handoff (10-500 chars)
  const trimmed = description.length > 450 ? description.slice(0, 447) + '...' : description;
  return trimmed.length < 10
    ? `${description}. An agent that handles this task.`
    : trimmed;
}

// ============================================================================
// Public API
// ============================================================================

export function analyzeTrikRequirements(
  description: string,
  constraints?: string,
): AnalyzeResult {
  const text = `${description} ${constraints || ''}`;
  const conversationalScore = countKeywords(text, CONVERSATIONAL_KEYWORDS);
  const toolModeScore = countKeywords(text, TOOL_MODE_KEYWORDS);
  const storageScore = countKeywords(text, STORAGE_KEYWORDS);
  const sessionScore = countKeywords(text, SESSION_KEYWORDS);
  const pythonScore = countKeywords(text, PYTHON_KEYWORDS);
  const tsScore = countKeywords(text, TYPESCRIPT_KEYWORDS);

  const isConversational = conversationalScore >= toolModeScore;
  const suggestedMode = isConversational ? 'conversational' : 'tool';

  const modeReason = isConversational
    ? `Conversational mode recommended: description suggests interactive, multi-turn interactions (matched ${conversationalScore} conversational keywords vs ${toolModeScore} tool-mode keywords).`
    : `Tool mode recommended: description suggests native tools that export to the main agent (matched ${toolModeScore} tool-mode keywords vs ${conversationalScore} conversational keywords).`;

  const suggestedLanguage: 'ts' | 'py' = pythonScore > tsScore ? 'py' : 'ts';
  const languageReason = pythonScore > tsScore
    ? `Python suggested: description mentions Python-related technologies (matched ${pythonScore} Python keywords vs ${tsScore} TypeScript keywords).`
    : pythonScore === tsScore && pythonScore === 0
      ? 'TypeScript suggested by default. Both Python and TypeScript are fully supported — specify your preference in constraints.'
      : `TypeScript suggested: description mentions JS/TS-related technologies (matched ${tsScore} TypeScript keywords vs ${pythonScore} Python keywords).`;

  const tools = extractTools(description);
  const domain = extractDomainTags(description);
  const config = extractConfigRequirements(description, constraints);
  const needsStorage = storageScore > 0;
  const needsSession = sessionScore > 0 || isConversational;

  const clarifyingQuestions: string[] = [];

  if (conversationalScore === toolModeScore) {
    clarifyingQuestions.push(
      'Should the trik handle multi-turn conversations (conversational) or export native tools to the main agent (tool mode)?',
    );
  }

  if (tools.length === 0) {
    clarifyingQuestions.push(
      'What specific operations should the trik perform? (e.g., search, create, list, analyze)',
    );
  }

  if (!needsStorage) {
    clarifyingQuestions.push(
      'Does the trik need to remember data across sessions (persistent storage)?',
    );
  }

  if (config.length === 0 && (description.toLowerCase().includes('api') || description.toLowerCase().includes('service'))) {
    clarifyingQuestions.push(
      'Which external APIs or services does the trik connect to? This determines config requirements.',
    );
  }

  return {
    suggestedMode,
    modeReason,
    suggestedLanguage,
    languageReason,
    suggestedHandoffDescription: isConversational ? generateHandoffDescription(description) : '',
    suggestedDomain: domain,
    suggestedTools: tools,
    suggestedCapabilities: {
      storage: needsStorage,
      session: needsSession,
      config,
    },
    clarifyingQuestions: clarifyingQuestions.slice(0, 4),
  };
}
