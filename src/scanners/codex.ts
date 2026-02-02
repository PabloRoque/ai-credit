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
 * Each JSONL entry has a top-level `type` and `payload` field:
 * - type: "session_meta" | "turn_context" | "response_item" | "event_msg"
 * - turn_context entries contain { payload: { cwd, model, ... } }
 * - response_item entries with payload.type "custom_tool_call" contain
 *   apply_patch operations with a custom patch format
 * - response_item entries with payload.type "function_call" contain
 *   shell_command calls
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
      const payload = entry.payload || {};

      // Extract timestamp
      if (!sessionTimestamp && entry.timestamp) {
        sessionTimestamp = new Date(entry.timestamp);
      }

      // Extract project path from turn_context or session_meta
      if (!sessionProjectPath) {
        if (entry.type === 'turn_context' && payload.cwd) {
          sessionProjectPath = payload.cwd;
        } else if (entry.type === 'session_meta' && payload.cwd) {
          sessionProjectPath = payload.cwd;
        }
      }

      // Handle custom_tool_call (apply_patch) — the primary way Codex writes files
      if (entry.type === 'response_item' && payload.type === 'custom_tool_call') {
        const patchChanges = this.parseApplyPatch(payload, projectPath, entry.timestamp);
        changes.push(...patchChanges);
        continue;
      }

      // Handle function_call (shell_command with file writes)
      if (entry.type === 'response_item' && payload.type === 'function_call') {
        const funcName = (payload.name || '').toLowerCase();
        let args: any = {};
        try {
          args = typeof payload.arguments === 'string'
            ? JSON.parse(payload.arguments)
            : payload.arguments || {};
        } catch {
          continue;
        }

        const change = this.parseFunctionCall(funcName, args, projectPath, entry.timestamp);
        if (change) {
          changes.push(change);
        }
        continue;
      }

      // Legacy format: top-level tool_calls / function_calls arrays
      const toolCalls = entry.tool_calls || entry.function_calls || [];
      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          const change = this.parseToolCall(toolCall, projectPath, entry.timestamp);
          if (change) {
            changes.push(change);
          }
        }
      }

      // Legacy: direct function format
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
   * Check if the session path belongs to the target project.
   * The session cwd must be exactly the project path or a subdirectory of it.
   */
  private pathsMatch(sessionPath: string, projectPath: string): boolean {
    if (sessionPath === projectPath) return true;
    // Session opened inside a subdirectory of the project
    if (sessionPath.startsWith(projectPath + '/')) return true;
    return false;
  }

  /**
   * Parse Codex apply_patch custom_tool_call entries.
   *
   * The patch format looks like:
   *   *** Begin Patch
   *   *** Update File: path/to/file.swift
   *   @@
   *    context line
   *   +added line
   *   -removed line
   *   *** Add File: path/to/new_file.swift
   *   +new file content
   *   *** End Patch
   */
  private parseApplyPatch(payload: any, projectPath: string, timestamp?: string): FileChange[] {
    const name = (payload.name || '').toLowerCase();
    if (name !== 'apply_patch') return [];

    const input = payload.input || '';
    if (!input) return [];

    const changes: FileChange[] = [];
    const lines = input.split('\n');

    let currentFile: string | null = null;
    let changeType: 'create' | 'modify' | 'delete' = 'modify';
    let linesAdded = 0;
    let linesRemoved = 0;

    const flushFile = () => {
      if (currentFile && (linesAdded > 0 || linesRemoved > 0)) {
        const filePath = this.normalizePath(currentFile, projectPath);
        changes.push({
          filePath,
          linesAdded,
          linesRemoved,
          changeType,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          tool: this.tool,
          content: '',
        });
      }
      currentFile = null;
      linesAdded = 0;
      linesRemoved = 0;
      changeType = 'modify';
    };

    for (const line of lines) {
      if (line.startsWith('*** Update File:')) {
        flushFile();
        currentFile = line.replace('*** Update File:', '').trim();
        changeType = 'modify';
      } else if (line.startsWith('*** Add File:')) {
        flushFile();
        currentFile = line.replace('*** Add File:', '').trim();
        changeType = 'create';
      } else if (line.startsWith('*** Delete File:')) {
        flushFile();
        currentFile = line.replace('*** Delete File:', '').trim();
        changeType = 'delete';
      } else if (line.startsWith('*** ')) {
        // Other directives (Begin Patch, End Patch, etc.) — skip
        continue;
      } else if (line.startsWith('@@')) {
        // Hunk header — skip
        continue;
      } else if (currentFile) {
        if (line.startsWith('+')) {
          linesAdded++;
        } else if (line.startsWith('-')) {
          linesRemoved++;
        }
        // Context lines (starting with ' ') are ignored
      }
    }

    flushFile();
    return changes;
  }

  /**
   * Parse a function_call payload (e.g. shell_command with file write operations)
   */
  private parseFunctionCall(funcName: string, args: any, projectPath: string, timestamp?: string): FileChange | null {
    const writeOps = ['write_file', 'create_file', 'write', 'save_file', 'create', 'writefile'];
    const editOps = ['edit_file', 'apply_diff', 'patch', 'replace_in_file', 'edit', 'update_file', 'modify_file'];

    let filePath = args.path || args.file_path || args.filename || args.file || args.target || '';
    let newContent = args.content || args.new_content || args.text || args.code || args.data || '';
    let oldContent = args.old_content || args.original || args.old_text || '';

    if (!filePath) return null;
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
      if ((funcName === 'apply_diff' || funcName === 'patch') && args.diff) {
        const diffStats = this.parseDiff(args.diff);
        linesAdded = diffStats.added;
        linesRemoved = diffStats.removed;
      }
    } else {
      return null;
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
   * Parse a legacy tool_call object to extract file changes
   */
  private parseToolCall(toolCall: any, projectPath: string, timestamp?: string): FileChange | null {
    const func = toolCall.function;
    if (!func) return null;

    const funcName = (func.name || '').toLowerCase();

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

    return this.parseFunctionCall(funcName, args, projectPath, timestamp);
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
