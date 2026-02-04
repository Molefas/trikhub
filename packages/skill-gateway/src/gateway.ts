import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type SkillManifest,
  type GatewayResult,
  type GatewaySuccessTemplate,
  type GatewaySuccessPassthrough,
  type ClarificationQuestion,
  type ClarificationAnswer,
  type ActionDefinition,
  type ResponseTemplate,
  type ResponseMode,
  type SkillSession,
  type PassthroughContent,
  type PassthroughDeliveryReceipt,
  type UserContentReference,
  type SessionHistoryEntry,
  validateManifest,
  SchemaValidator,
} from '@saaas-poc/skill-manifest';
import { type SessionStorage, InMemorySessionStorage } from './session-storage.js';

interface SkillInput {
  action: string;
  input: unknown;
  session?: {
    sessionId: string;
    history: SessionHistoryEntry[];
  };
}

interface SkillOutput {
  responseMode: ResponseMode;
  agentData?: unknown;
  userContent?: PassthroughContent;
  endSession?: boolean;
  needsClarification?: boolean;
  clarificationQuestions?: ClarificationQuestion[];
}

interface SkillGraph {
  invoke(input: SkillInput): Promise<SkillOutput>;
}

export interface SkillGatewayConfig {
  allowedSkills?: string[];
  onClarificationNeeded?: (
    skillId: string,
    questions: ClarificationQuestion[]
  ) => Promise<ClarificationAnswer[]>;
  sessionStorage?: SessionStorage;
}

export interface ExecuteSkillOptions {
  sessionId?: string;
}

export type GatewayResultWithSession<TAgent = unknown> = GatewayResult<TAgent> & {
  sessionId?: string;
};

interface LoadedSkill {
  manifest: SkillManifest;
  graph: SkillGraph;
  path: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: import('@saaas-poc/skill-manifest').JSONSchema;
  responseMode: ResponseMode;
  isGatewayTool?: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  sessionEnabled: boolean;
}

export interface GetToolDefinitionsOptions {
  includeReadContent?: boolean;
}

export class SkillGateway {
  private validator = new SchemaValidator();
  private config: SkillGatewayConfig;
  private sessionStorage: SessionStorage;

  // Loaded skills (by skill ID)
  private skills = new Map<string, LoadedSkill>();
  private contentReferences = new Map<string, UserContentReference>();
  private static CONTENT_REF_TTL_MS = 10 * 60 * 1000;

  constructor(config: SkillGatewayConfig = {}) {
    this.config = config;
    this.sessionStorage = config.sessionStorage ?? new InMemorySessionStorage();
  }

  async loadSkill(skillPath: string): Promise<SkillManifest> {
    const manifestPath = join(skillPath, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);

    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${validation.errors?.join(', ')}`);
    }

    const manifest = manifestData as SkillManifest;

    if (this.config.allowedSkills && !this.config.allowedSkills.includes(manifest.id)) {
      throw new Error(`Skill "${manifest.id}" is not in the allowlist`);
    }

    const modulePath = join(skillPath, manifest.entry.module);
    const moduleUrl = pathToFileURL(modulePath).href;
    const module = await import(moduleUrl);
    const graph = module[manifest.entry.export] as SkillGraph;

    if (!graph || typeof graph.invoke !== 'function') {
      throw new Error(
        `Invalid graph at ${modulePath}: export "${manifest.entry.export}" must have an invoke function`
      );
    }

    this.skills.set(manifest.id, { manifest, graph, path: skillPath });

    return manifest;
  }

  getManifest(skillId: string): SkillManifest | undefined {
    return this.skills.get(skillId)?.manifest;
  }

  getLoadedSkills(): string[] {
    return Array.from(this.skills.keys());
  }

  isLoaded(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  getAvailableSkills(): SkillInfo[] {
    return Array.from(this.skills.values()).map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      sessionEnabled: manifest.capabilities?.session?.enabled ?? false,
      tools: Object.entries(manifest.actions).map(([actionName, action]) =>
        this.actionToToolDefinition(manifest.id, actionName, action)
      ),
    }));
  }

  getToolDefinitions(_options: GetToolDefinitionsOptions = {}): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const { manifest } of this.skills.values()) {
      for (const [actionName, action] of Object.entries(manifest.actions)) {
        const tool = this.actionToToolDefinition(manifest.id, actionName, action);
        tools.push(tool);
      }
    }

    return tools;
  }

  private actionToToolDefinition(
    skillId: string,
    actionName: string,
    action: ActionDefinition
  ): ToolDefinition {
    return {
      name: `${skillId}:${actionName}`,
      description: action.description || `Execute ${actionName} on ${skillId}`,
      inputSchema: action.inputSchema,
      responseMode: action.responseMode,
    };
  }

  async execute<TAgent = unknown>(
    skillId: string,
    actionName: string,
    input: unknown,
    options?: ExecuteSkillOptions
  ): Promise<GatewayResultWithSession<TAgent>> {
    const loaded = this.skills.get(skillId);
    if (!loaded) {
      return {
        success: false,
        code: 'SKILL_NOT_FOUND',
        error: `Skill "${skillId}" is not loaded. Call loadSkill() first.`,
      };
    }

    const { manifest, graph } = loaded;

    const action = manifest.actions[actionName];
    if (!action) {
      return {
        success: false,
        code: 'INVALID_INPUT',
        error: `Action "${actionName}" not found. Available: ${Object.keys(manifest.actions).join(', ')}`,
      };
    }

    const inputValidation = this.validator.validate(
      `${skillId}:${actionName}:input`,
      action.inputSchema,
      input
    );
    if (!inputValidation.valid) {
      return {
        success: false,
        code: 'INVALID_INPUT',
        error: `Invalid input: ${inputValidation.errors?.join(', ')}`,
      };
    }

    let session: SkillSession | null = null;
    if (manifest.capabilities?.session?.enabled) {
      if (options?.sessionId) {
        session = await this.sessionStorage.get(options.sessionId);
      }
      if (!session) {
        session = await this.sessionStorage.create(skillId, manifest.capabilities.session);
      }
    }

    try {
      const skillInput: SkillInput = {
        action: actionName,
        input,
        session: session
          ? {
              sessionId: session.sessionId,
              history: session.history,
            }
          : undefined,
      };

      const result = await this.executeWithTimeout(
        graph,
        skillInput,
        manifest.limits.maxExecutionTimeMs
      );

      if (result.needsClarification && result.clarificationQuestions?.length) {
        if (this.config.onClarificationNeeded) {
          await this.config.onClarificationNeeded(skillId, result.clarificationQuestions);
        }

        return {
          success: false,
          code: 'CLARIFICATION_NEEDED',
          sessionId: session?.sessionId ?? '',
          questions: result.clarificationQuestions,
        };
      }

      return this.processResult<TAgent>(skillId, actionName, action, session, result);
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMEOUT') {
        return {
          success: false,
          code: 'TIMEOUT',
          error: `Execution timed out after ${manifest.limits.maxExecutionTimeMs}ms`,
        };
      }

      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeWithTimeout(
    graph: SkillGraph,
    input: SkillInput,
    timeoutMs: number
  ): Promise<SkillOutput> {
    return Promise.race([
      graph.invoke(input),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)),
    ]);
  }

  private async processResult<TAgent>(
    skillId: string,
    actionName: string,
    action: ActionDefinition,
    session: SkillSession | null,
    result: SkillOutput
  ): Promise<GatewayResultWithSession<TAgent>> {
    const effectiveMode: ResponseMode = result.responseMode || action.responseMode;

    if (session) {
      if (result.endSession) {
        await this.sessionStorage.delete(session.sessionId);
        session = null;
      } else {
        await this.sessionStorage.addHistory(session.sessionId, {
          action: actionName,
          input: {},
          agentData: result.agentData,
          userContent: result.userContent,
        });
      }
    }

    if (effectiveMode === 'passthrough') {
      if (result.userContent === undefined) {
        return { success: false, code: 'INVALID_OUTPUT', error: 'Passthrough mode requires userContent' };
      }

      if (action.userContentSchema) {
        const userValidation = this.validator.validate(
          `${skillId}:${actionName}:userContent`,
          action.userContentSchema,
          result.userContent
        );

        if (!userValidation.valid) {
          return {
            success: false,
            code: 'INVALID_OUTPUT',
            error: `Invalid userContent: ${userValidation.errors?.join(', ')}`,
          };
        }
      }

      const userContent = result.userContent;
      const contentRef = this.storePassthroughContent(skillId, actionName, userContent);

      const gatewayResult: GatewaySuccessPassthrough = {
        success: true,
        responseMode: 'passthrough',
        userContentRef: contentRef,
        contentType: userContent.contentType,
        metadata: userContent.metadata,
      };

      return this.addSessionId(gatewayResult, session);
    }

    if (result.agentData === undefined) {
      return { success: false, code: 'INVALID_OUTPUT', error: 'Template mode requires agentData' };
    }

    if (action.agentDataSchema) {
      const agentValidation = this.validator.validate(
        `${skillId}:${actionName}:agentData`,
        action.agentDataSchema,
        result.agentData
      );

      if (!agentValidation.valid) {
        return {
          success: false,
          code: 'INVALID_OUTPUT',
          error: `Invalid agentData: ${agentValidation.errors?.join(', ')}`,
        };
      }
    }

    // Get template text if available
    const agentData = result.agentData as Record<string, unknown>;
    const templateId = agentData.template as string | undefined;
    const templateText = templateId && action.responseTemplates?.[templateId]?.text;

    const gatewayResult: GatewaySuccessTemplate<TAgent> = {
      success: true,
      responseMode: 'template',
      agentData: result.agentData as TAgent,
      templateText,
    };

    return this.addSessionId(gatewayResult, session);
  }

  /**
   * Add sessionId to result if session exists
   */
  private addSessionId<T extends GatewayResult>(
    result: T,
    session: SkillSession | null
  ): T & { sessionId?: string } {
    if (session) {
      return { ...result, sessionId: session.sessionId };
    }
    return result;
  }

  // ============================================
  // Passthrough Content Management
  // ============================================

  /**
   * Store passthrough content and return a reference
   */
  private storePassthroughContent(
    skillId: string,
    actionName: string,
    content: PassthroughContent
  ): string {
    this.cleanupExpiredContentReferences();

    const ref = randomUUID();
    const now = Date.now();

    this.contentReferences.set(ref, {
      ref,
      skillId,
      actionName,
      content,
      createdAt: now,
      expiresAt: now + SkillGateway.CONTENT_REF_TTL_MS,
    });

    return ref;
  }

  /**
   * Clean up expired content references
   */
  private cleanupExpiredContentReferences(): void {
    const now = Date.now();
    for (const [ref, contentRef] of this.contentReferences) {
      if (contentRef.expiresAt < now) {
        this.contentReferences.delete(ref);
      }
    }
  }

  /**
   * Deliver passthrough content to the user.
   * One-time delivery - the reference is deleted after delivery.
   */
  deliverContent(ref: string): {
    content: PassthroughContent;
    receipt: PassthroughDeliveryReceipt;
  } | null {
    const contentRef = this.contentReferences.get(ref);

    if (!contentRef) {
      return null;
    }

    if (contentRef.expiresAt < Date.now()) {
      this.contentReferences.delete(ref);
      return null;
    }

    // One-time delivery
    this.contentReferences.delete(ref);

    return {
      content: contentRef.content,
      receipt: {
        delivered: true,
        contentType: contentRef.content.contentType,
        metadata: contentRef.content.metadata,
      },
    };
  }

  hasContentRef(ref: string): boolean {
    const contentRef = this.contentReferences.get(ref);
    if (!contentRef) return false;
    if (contentRef.expiresAt < Date.now()) {
      this.contentReferences.delete(ref);
      return false;
    }
    return true;
  }

  getContentRefInfo(ref: string): { contentType: string; metadata?: Record<string, unknown> } | null {
    const contentRef = this.contentReferences.get(ref);
    if (!contentRef || contentRef.expiresAt < Date.now()) {
      return null;
    }
    return {
      contentType: contentRef.content.contentType,
      metadata: contentRef.content.metadata,
    };
  }

  resolveTemplate(template: ResponseTemplate, agentData: Record<string, unknown>): string {
    let text = template.text;

    const placeholderRegex = /\{\{(\w+)\}\}/g;
    text = text.replace(placeholderRegex, (_, fieldName) => {
      const value = agentData[fieldName];
      return value !== undefined ? String(value) : `{{${fieldName}}}`;
    });

    return text;
  }

  getActionTemplates(skillId: string, actionName: string): Record<string, ResponseTemplate> | undefined {
    const manifest = this.skills.get(skillId)?.manifest;
    if (!manifest) return undefined;

    const action = manifest.actions[actionName];
    if (!action) return undefined;

    return action.responseTemplates;
  }
}
