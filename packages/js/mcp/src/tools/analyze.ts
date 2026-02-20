/**
 * Trik Requirements Analysis Tool
 *
 * Analyzes a user's description and suggests trik architecture,
 * actions, capabilities, and clarifying questions.
 */

import type {
  AnalysisResult,
  SuggestedAction,
  SuggestedCapabilities,
  TrikArchitecture,
} from './types.js';

/**
 * Keywords that suggest LangGraph is needed
 */
const LANGGRAPH_KEYWORDS = [
  'workflow',
  'multi-step',
  'pipeline',
  'chain',
  'conditional',
  'branching',
  'retry',
  'loop',
  'iterate',
  'sequence',
  'orchestrate',
  'coordinate',
  'state machine',
  'decision',
  'if-then',
  'llm call',
  'agent',
  'reasoning',
];

/**
 * Keywords that suggest storage is needed
 */
const STORAGE_KEYWORDS = [
  'remember',
  'save',
  'store',
  'persist',
  'history',
  'cache',
  'track',
  'log',
  'bookmark',
  'favorite',
  'preference',
  'setting',
  'state',
  'session',
  'across sessions',
];

/**
 * Keywords that suggest session is needed
 */
const SESSION_KEYWORDS = [
  'conversation',
  'context',
  'follow-up',
  'reference',
  'the first',
  'the second',
  'that one',
  'previous',
  'earlier',
  'multi-turn',
];

/**
 * Common API patterns and their likely config requirements
 */
const API_PATTERNS: Record<string, string[]> = {
  github: ['GITHUB_TOKEN'],
  twitter: ['TWITTER_API_KEY', 'TWITTER_API_SECRET'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY'],
  slack: ['SLACK_TOKEN'],
  discord: ['DISCORD_TOKEN'],
  stripe: ['STRIPE_API_KEY'],
  aws: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  database: ['DATABASE_URL'],
  api: ['API_KEY'],
  weather: ['WEATHER_API_KEY'],
  news: ['NEWS_API_KEY'],
};

/**
 * Action patterns based on common verbs
 */
const ACTION_PATTERNS: Record<string, { complexity: 'simple' | 'moderate' | 'complex'; responseMode: 'template' | 'passthrough' }> = {
  search: { complexity: 'moderate', responseMode: 'template' },
  find: { complexity: 'moderate', responseMode: 'template' },
  list: { complexity: 'simple', responseMode: 'template' },
  get: { complexity: 'simple', responseMode: 'passthrough' },
  fetch: { complexity: 'simple', responseMode: 'passthrough' },
  read: { complexity: 'simple', responseMode: 'passthrough' },
  create: { complexity: 'moderate', responseMode: 'template' },
  add: { complexity: 'simple', responseMode: 'template' },
  update: { complexity: 'moderate', responseMode: 'template' },
  delete: { complexity: 'simple', responseMode: 'template' },
  remove: { complexity: 'simple', responseMode: 'template' },
  analyze: { complexity: 'complex', responseMode: 'passthrough' },
  summarize: { complexity: 'complex', responseMode: 'passthrough' },
  generate: { complexity: 'complex', responseMode: 'passthrough' },
  convert: { complexity: 'moderate', responseMode: 'passthrough' },
  transform: { complexity: 'moderate', responseMode: 'passthrough' },
  monitor: { complexity: 'complex', responseMode: 'template' },
  alert: { complexity: 'moderate', responseMode: 'template' },
  notify: { complexity: 'simple', responseMode: 'template' },
  download: { complexity: 'moderate', responseMode: 'passthrough' },
  upload: { complexity: 'moderate', responseMode: 'template' },
};

function containsKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function extractApiPatterns(text: string): string[] {
  const lower = text.toLowerCase();
  const configs: string[] = [];

  for (const [pattern, keys] of Object.entries(API_PATTERNS)) {
    if (lower.includes(pattern)) {
      configs.push(...keys);
    }
  }

  return [...new Set(configs)];
}

function suggestActions(description: string): SuggestedAction[] {
  const lower = description.toLowerCase();
  const actions: SuggestedAction[] = [];

  // Extract verbs and nouns to suggest actions
  const words = lower.split(/\s+/);

  for (const [verb, config] of Object.entries(ACTION_PATTERNS)) {
    if (lower.includes(verb)) {
      // Find the noun after the verb
      const verbIndex = words.findIndex((w) => w.includes(verb));
      const noun = verbIndex < words.length - 1 ? words[verbIndex + 1] : 'items';

      actions.push({
        name: `${verb}${capitalize(noun.replace(/[^a-z]/g, ''))}`,
        purpose: `${capitalize(verb)} ${noun}`,
        complexity: config.complexity,
        responseMode: config.responseMode,
      });
    }
  }

  // If no actions found, suggest a generic main action
  if (actions.length === 0) {
    actions.push({
      name: 'execute',
      purpose: 'Main action for the trik',
      complexity: 'moderate',
      responseMode: 'template',
    });
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return actions.filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });
}

function determineArchitecture(description: string, actions: SuggestedAction[]): { arch: TrikArchitecture; reason: string } {
  const needsLangGraph = containsKeywords(description, LANGGRAPH_KEYWORDS);
  const hasComplexActions = actions.some((a) => a.complexity === 'complex');
  const hasMultipleActions = actions.length > 2;

  if (needsLangGraph) {
    return {
      arch: 'langgraph',
      reason: 'Description suggests multi-step workflow or conditional logic',
    };
  }

  if (hasComplexActions && hasMultipleActions) {
    return {
      arch: 'langgraph',
      reason: 'Multiple complex actions may benefit from LangGraph orchestration',
    };
  }

  return {
    arch: 'simple',
    reason: 'Simple actions can be handled with direct function calls',
  };
}

function suggestCapabilities(description: string): SuggestedCapabilities {
  return {
    storage: containsKeywords(description, STORAGE_KEYWORDS),
    session: containsKeywords(description, SESSION_KEYWORDS),
    config: extractApiPatterns(description),
  };
}

function generateClarifyingQuestions(
  description: string,
  actions: SuggestedAction[],
  capabilities: SuggestedCapabilities
): string[] {
  const questions: string[] = [];

  // Ask about response mode if not clear
  if (actions.some((a) => !a.responseMode)) {
    questions.push(
      'Should the agent see the full content (template mode) or should content go directly to the user (passthrough mode)?'
    );
  }

  // Ask about storage if mentioned but not explicit
  if (!capabilities.storage && description.length > 50) {
    questions.push('Do you need to remember data between sessions (persistent storage)?');
  }

  // Ask about session if follow-up seems likely
  if (!capabilities.session && actions.length > 1) {
    questions.push('Will users ask follow-up questions about previous results?');
  }

  // Ask about authentication if APIs are involved
  if (capabilities.config.length > 0) {
    questions.push(
      `This seems to need API access. Do you have the required API keys? (${capabilities.config.join(', ')})`
    );
  }

  // Ask about error handling
  questions.push('How should the trik handle errors? (retry, fallback, or report to user)');

  return questions.slice(0, 4); // Limit to 4 questions
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Analyze trik requirements from a user description
 */
export function analyzeTrikRequirements(
  description: string,
  constraints?: string
): AnalysisResult {
  const fullText = constraints ? `${description} ${constraints}` : description;

  const actions = suggestActions(fullText);
  const { arch, reason } = determineArchitecture(fullText, actions);
  const capabilities = suggestCapabilities(fullText);
  const questions = generateClarifyingQuestions(fullText, actions, capabilities);

  return {
    suggestedActions: actions,
    recommendedArchitecture: arch,
    architectureReason: reason,
    suggestedCapabilities: capabilities,
    clarifyingQuestions: questions,
  };
}
