/**
 * Shared types for MCP tools
 */

export type TrikComplexity = 'simple' | 'moderate' | 'complex';
export type TrikArchitecture = 'simple' | 'langgraph';
export type ResponseMode = 'template' | 'passthrough';

export interface SuggestedAction {
  name: string;
  purpose: string;
  complexity: TrikComplexity;
  responseMode?: ResponseMode;
}

export interface SuggestedCapabilities {
  storage: boolean;
  session: boolean;
  config: string[];
}

export interface AnalysisResult {
  suggestedActions: SuggestedAction[];
  recommendedArchitecture: TrikArchitecture;
  architectureReason: string;
  suggestedCapabilities: SuggestedCapabilities;
  clarifyingQuestions: string[];
}

export interface ValidationError {
  path: string;
  message: string;
  fix?: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  securityScore: number;
}

export interface FieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  values?: string[]; // For enums
  isUserContent?: boolean; // For output fields
}

export interface ActionDesignInput {
  actionName: string;
  purpose: string;
  responseMode: ResponseMode;
  inputFields: FieldDefinition[];
  outputFields: FieldDefinition[];
}

export interface ActionDesignResult {
  actionDefinition: Record<string, unknown>;
  warnings: string[];
  suggestions: string[];
}

export interface SchemaDesignInput {
  fields: FieldDefinition[];
  schemaType: 'agentData' | 'userContent' | 'input';
}

export interface SchemaDesignResult {
  schema: Record<string, unknown>;
  securityNotes: string[];
  valid: boolean;
}

export type TrikCategory =
  | 'utilities'
  | 'productivity'
  | 'developer'
  | 'data'
  | 'search'
  | 'content'
  | 'communication'
  | 'finance'
  | 'entertainment'
  | 'education'
  | 'other';

export interface ScaffoldInput {
  name: string;
  displayName: string;
  description: string;
  language: 'ts' | 'py';
  category: TrikCategory;
  architecture: TrikArchitecture;
  actions: Record<string, unknown>[];
  capabilities: {
    storage?: boolean;
    session?: boolean;
    config?: Array<{ key: string; description: string }>;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ScaffoldResult {
  files: GeneratedFile[];
  nextSteps: string[];
  implementationNotes: Record<string, string>;
}
