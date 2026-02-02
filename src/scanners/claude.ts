import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { AISession, AITool, FileChange } from '../types.js';
import { BaseScanner } from './base.js';

/**
 * Scanner for Claude Code sessions
 * 
 * Claude Code stores session data in:
 * ~/.claude/projects/<path-encoded-project-name>/*.jsonl
 * 
 * Each JSONL file contains conversation turns with tool_use blocks
 * that record file operations (write, edit, etc.)
 */
export class ClaudeScanner extends BaseScanner {
  get tool(): AITool {
    return AITool.CLAUDE_CODE;
  }

  get storagePath(): string {
    return '~/.claude/projects';
  }

  /**
   * Encode project path to match Claude's directory naming convention
   * Claude encodes paths by replacing / with -
   */
  private encodeProjectPath(projectPath: string): string {
    return projectPath.replace(/\//g, '-').replace(/^-/, '');
  }

  /**
   * Decode Claude's directory name back to a path
   */
  private decodeProjectPath(encodedPath: string): string {
    return '/' + encodedPath.replace(/-/g, '/');
  }

  scan(projectPath: string): AISession[] {
    const sessions: AISession[] = [];
    const basePath = this.resolveStoragePath();
    
    if (!fs.existsSync(basePath)) {
      return sessions;
    }

    // Try to find the project directory
    const encodedPath = this.encodeProjectPath(projectPath);
    const projectDir = path.join(basePath, encodedPath);
    const projectBasename = path.basename(projectPath);

    // Collect all possible matching directories
    const possibleDirs = new Set<string>();
    
    // Add exact match
    if (fs.existsSync(projectDir)) {
      possibleDirs.add(projectDir);
    }

    // Scan all directories to find matches
    try {
      const allDirs = fs.readdirSync(basePath);
      for (const dir of allDirs) {
        const fullDir = path.join(basePath, dir);
        if (!fs.statSync(fullDir).isDirectory()) continue;

        // Check various matching criteria
        const decodedPath = this.decodeProjectPath(dir);
        
        // Match by:
        // 1. Directory name contains project basename
        // 2. Decoded path ends with project path
        // 3. Project path ends with decoded path
        // 4. Same basename
        if (dir.includes(projectBasename) ||
            dir.toLowerCase().includes(projectBasename.toLowerCase()) ||
            decodedPath.endsWith(projectPath) ||
            projectPath.endsWith(decodedPath.slice(1)) ||
            path.basename(decodedPath) === projectBasename) {
          possibleDirs.add(fullDir);
        }
      }
    } catch {
      // Ignore errors
    }

    // Parse all session files from matching directories
    for (const dir of possibleDirs) {
      try {
        const files = glob.sync('*.jsonl', { cwd: dir });
        for (const file of files) {
          const session = this.parseSessionFile(path.join(dir, file), projectPath);
          if (session && session.changes.length > 0) {
            sessions.push(session);
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return sessions;
  }

  parseSessionFile(filePath: string, projectPath: string): AISession | null {
    const entries = this.readJsonlFile(filePath);
    if (entries.length === 0) return null;

    const changes: FileChange[] = [];
    let sessionTimestamp: Date | null = null;

    for (const entry of entries) {
      // Extract timestamp from various possible fields
      if (!sessionTimestamp) {
        if (entry.timestamp) {
          sessionTimestamp = new Date(entry.timestamp);
        } else if (entry.created_at) {
          sessionTimestamp = new Date(entry.created_at);
        }
      }

      // Look for assistant messages with tool_use
      if (entry.type === 'assistant' && entry.message?.content) {
        const content = Array.isArray(entry.message.content) 
          ? entry.message.content 
          : [entry.message.content];

        for (const block of content) {
          if (block.type === 'tool_use') {
            const change = this.parseToolUse(block, projectPath, entry.timestamp);
            if (change) {
              changes.push(change);
            }
          }
        }
      }

      // Also check for tool_result entries that might contain file info
      if (entry.type === 'tool_result' && entry.content) {
        // Tool results might indicate successful file operations
        // but we primarily track from tool_use
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
   * Parse a tool_use block to extract file changes
   */
  private parseToolUse(block: any, projectPath: string, timestamp?: number): FileChange | null {
    const toolName = block.name?.toLowerCase() || '';
    const input = block.input || {};

    // Supported write operations - expanded list
    const writeOps = ['write', 'write_file', 'create_file', 'str_replace_editor', 'save_file', 'create'];
    const editOps = ['edit', 'edit_file', 'str_replace', 'apply_diff', 'patch', 'update_file'];

    // Try various field names for file path
    let filePath = input.path || input.file_path || input.filename || input.file || input.target || '';
    let newContent = input.content || input.new_str || input.text || input.code || '';
    let oldContent = input.old_str || input.old_content || input.original || '';

    if (!filePath) return null;

    // Normalize path
    filePath = this.normalizePath(filePath, projectPath);

    let changeType: 'create' | 'modify' | 'delete' = 'modify';
    let linesAdded = 0;
    let linesRemoved = 0;

    if (writeOps.includes(toolName)) {
      changeType = oldContent ? 'modify' : 'create';
      linesAdded = this.countLines(newContent);
      linesRemoved = this.countLines(oldContent);
    } else if (editOps.includes(toolName)) {
      changeType = 'modify';
      linesAdded = this.countLines(newContent);
      linesRemoved = this.countLines(oldContent);
    } else {
      // Unknown tool, try to extract what we can
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
}
