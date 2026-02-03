/**
 * Supported AI coding tools
 */
export enum AITool {
  CLAUDE_CODE = 'claude',
  CODEX = 'codex',
  CURSOR = 'cursor',
  GEMINI = 'gemini',
  OPENCODE = 'opencode',
}

/**
 * Represents a single file change made by an AI tool
 */
export interface FileChange {
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  changeType: 'create' | 'modify' | 'delete';
  timestamp: Date;
  tool: AITool;
  content?: string;
  addedLines?: string[];
  model?: string;
}

/**
 * Represents an AI session containing multiple file changes
 */
export interface AISession {
  id: string;
  tool: AITool;
  timestamp: Date;
  projectPath: string;
  changes: FileChange[];
  totalFilesChanged: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  model?: string;
}

/**
 * Statistics for a single AI model
 */
export interface ModelStats {
  model: string;
  sessionsCount: number;
  filesCreated: number;
  filesModified: number;
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
  netLines: number;
}

/**
 * Statistics for a single AI tool
 */
export interface ToolStats {
  tool: AITool;
  sessionsCount: number;
  filesCreated: number;
  filesModified: number;
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
  netLines: number;
  byModel: Map<string, ModelStats>;
}

/**
 * Statistics for a single file
 */
export interface FileStats {
  filePath: string;
  totalLines: number;
  aiContributedLines: number;
  aiContributionRatio: number;
  contributions: Map<AITool, number>;
}

/**
 * Overall contribution statistics
 */
export interface ContributionStats {
  repoPath: string;
  scanTime: Date;
  totalFiles: number;
  totalLines: number;
  aiTouchedFiles: number;
  aiContributedLines: number;
  sessions: AISession[];
  byTool: Map<AITool, ToolStats>;
  byFile: Map<string, FileStats>;
}

/**
 * Output format options
 */
export type OutputFormat = 'console' | 'json' | 'markdown';

/**
 * CLI options
 */
export interface CLIOptions {
  format: OutputFormat;
  output?: string;
  tools?: AITool[];
  verbose: boolean;
}
