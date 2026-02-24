/**
 * Shared types for v2 MCP tools.
 */

import type { JSONSchema } from '@trikhub/manifest';

// ============================================================================
// analyze_trik_requirements
// ============================================================================

export interface AnalyzeResult {
  suggestedMode: 'conversational' | 'one-shot';
  modeReason: string;
  suggestedHandoffDescription: string;
  suggestedDomain: string[];
  suggestedTools: Array<{
    name: string;
    description: string;
    hasLogTemplate: boolean;
  }>;
  suggestedCapabilities: {
    storage: boolean;
    session: boolean;
    config: Array<{ key: string; description: string }>;
  };
  clarifyingQuestions: string[];
}

// ============================================================================
// design_tool
// ============================================================================

export interface DesignToolResult {
  toolDeclaration: {
    description: string;
    logTemplate?: string;
    logSchema?: Record<string, JSONSchema>;
  };
  warnings: string[];
  suggestions: string[];
}

// ============================================================================
// design_log_schema
// ============================================================================

export interface DesignLogSchemaResult {
  logSchema: Record<string, JSONSchema>;
  warnings: string[];
}

// ============================================================================
// scaffold_trik
// ============================================================================

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  nextSteps: string[];
}

// ============================================================================
// validate_manifest
// ============================================================================

export interface ValidateResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; fix: string }>;
  warnings: Array<{ path: string; message: string; suggestion?: string }>;
  qualityScore: number;
}

// ============================================================================
// diagnose_error
// ============================================================================

export interface DiagnoseResult {
  explanation: string;
  rootCause: string;
  suggestedFix: string;
  relatedDocs: string[];
}
