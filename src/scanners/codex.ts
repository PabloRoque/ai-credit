import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { AISession, AITool, FileChange } from '../types.js';
import { BaseScanner } from './base.js';

/**
 * Scanner for OpenAI Codex CLI sessions
 * 
 * Codex CLI stores session data in:
 * ~/.codex/sessions/YYYY/MM/DD/*.jsonl
 * 
 * Each JSONL file contains entries with tool_calls arrays
 * that record function calls like write_file, apply_diff, etc.
 */
export class CodexScanner extends BaseScanner {
  get tool(): AITool {
    return AITool.CODEX;
  }

  get storagePath(): string {
    return '~/.codex/sessions';
  }

  scan(projectPath: string): AISession[] {
    const sessions: AISession[] = [];
    const basePath = this.resolveStoragePath();
    
    if (!fs.existsSync(basePath)) {
      return sessions;
    }

    try {
      // Recursively find all JSONL files
      const files = glob.sync('**/*.jsonl', { cwd: basePath });
      
      for (const file of files) {
        const fullPath = path.join(basePath, file);
        const session = this.parseSessionFile(fullPath, projectPath);
        if (session && session.changes.length > 0) {
          sessions.push(session);
        }
      }
    } catch {
      // Ignore errors
    }

    return sessions;
  }

  parseSessionFile(filePath: string, projectPath: string): AISession | null {
    const entries = this.readJsonlFile(filePath);
    if (entries.length === 0) return null;

    const changes: FileChange[] = [];
    let sessionTimestamp: Date | null = null;
    let sessionProjectPath: string | null = null;

    for (const entry of entries) {
      // Extract timestamp and project path from various possible fields
      if (!sessionTimestamp) {
        if (entry.timestamp) {
          sessionTimestamp = new Date(entry.timestamp);
        } else if (entry.created_at) {
          sessionTimestamp = new Date(entry.created_at);
        }
      }
      
      // Try to find project path from various fields
      if (!sessionProjectPath) {
        sessionProjectPath = entry.cwd || entry.working_directory || entry.project_path || null;
      }

      // Look for tool_calls in various formats
      const toolCalls = entry.tool_calls || entry.function_calls || [];
      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          const change = this.parseToolCall(toolCall, projectPath, entry.timestamp);
          if (change) {
            changes.push(change);
          }
        }
      }

      // Also check for direct function call format
      if (entry.function && entry.function.name) {
        const change = this.parseToolCall({ function: entry.function }, projectPath, entry.timestamp);
        if (change) {
          changes.push(change);
        }
      }
    }

    // Filter: only include sessions that match the project path
    if (sessionProjectPath) {
      const normalizedSessionPath = path.resolve(sessionProjectPath);
      const normalizedProjectPath = path.resolve(projectPath);
      
      // Check if paths match or are related
      if (!this.pathsMatch(normalizedSessionPath, normalizedProjectPath)) {
        return null;
      }
    }

    if (changes.length === 0) return null;

    return {
      id: this.generateSessionId(filePath),
      tool: this.tool,
      timestamp: sessionTimestamp || new Date(),
      projectPath,
      changes,
      totalFilesChanged: new Set(changes.map(c => c.filePath)).size,
      totalLinesAdded: changes.reduce((sum, c) => sum + c.linesAdded, 0),
      totalLinesRemoved: changes.reduce((sum, c) => sum + c.linesRemoved, 0),
    };
  }

  /**
   * Check if two paths match or are related
   */
  private pathsMatch(path1: string, path2: string): boolean {
    // Exact match
    if (path1 === path2) return true;
    
    // One contains the other
    if (path1.startsWith(path2) || path2.startsWith(path1)) return true;
    
    // Same basename (project name)
    if (path.basename(path1) === path.basename(path2)) return true;
    
    return false;
  }

  /**
   * Parse a tool_call object to extract file changes
   */
  private parseToolCall(toolCall: any, projectPath: string, timestamp?: number): FileChange | null {
    const func = toolCall.function;
    if (!func) return null;

    const funcName = (func.name || '').toLowerCase();
    
    // Parse arguments - they come as a JSON string or object
    let args: any = {};
    try {
      if (typeof func.arguments === 'string') {
        args = JSON.parse(func.arguments);
      } else if (typeof func.arguments === 'object') {
        args = func.arguments || {};
      }
    } catch {
      return null;
    }

    // Supported operations - expanded list
    const writeOps = ['write_file', 'create_file', 'write', 'save_file', 'create', 'writefile'];
    const editOps = ['edit_file', 'apply_diff', 'patch', 'replace_in_file', 'edit', 'update_file', 'modify_file'];

    // Try various field names for file path
    let filePath = args.path || args.file_path || args.filename || args.file || args.target || '';
    let newContent = args.content || args.new_content || args.text || args.code || args.data || '';
    let oldContent = args.old_content || args.original || args.old_text || '';

    if (!filePath) return null;

    // Normalize path
    filePath = this.normalizePath(filePath, projectPath);

    let changeType: 'create' | 'modify' | 'delete' = 'modify';
    let linesAdded = 0;
    let linesRemoved = 0;

    if (writeOps.includes(funcName)) {
      changeType = 'create';
      linesAdded = this.countLines(newContent);
    } else if (editOps.includes(funcName)) {
      changeType = 'modify';
      linesAdded = this.countLines(newContent);
      linesRemoved = this.countLines(oldContent);
      
      // For diff operations, try to parse the diff
      if ((funcName === 'apply_diff' || funcName === 'patch') && args.diff) {
        const diffStats = this.parseDiff(args.diff);
        linesAdded = diffStats.added;
        linesRemoved = diffStats.removed;
      }
    } else {
      // Unknown function, try to extract what we can
      if (newContent) {
        linesAdded = this.countLines(newContent);
      }
    }

    if (linesAdded === 0 && linesRemoved === 0) return null;

    return {
      filePath,
      linesAdded,
      linesRemoved,
      changeType,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      tool: this.tool,
      content: newContent,
    };
  }

  /**
   * Parse a unified diff to count added/removed lines
   */
  private parseDiff(diff: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;

    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed++;
      }
    }

    return { added, removed };
  }
}
