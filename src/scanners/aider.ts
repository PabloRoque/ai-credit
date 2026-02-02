import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { AISession, AITool, FileChange } from '../types.js';
import { BaseScanner } from './base.js';

/**
 * Scanner for Aider sessions
 * 
 * Aider stores chat history in:
 * <project>/.aider.chat.history.md
 * <project>/.aider.input.history
 * <project>/.aider/
 * 
 * The file contains markdown-formatted conversation with
 * code blocks that show file changes.
 */
export class AiderScanner extends BaseScanner {
  get tool(): AITool {
    return AITool.AIDER;
  }

  get storagePath(): string {
    return '.aider.chat.history.md';
  }

  /**
   * For Aider, storage is project-local
   */
  protected resolveStoragePath(): string {
    return this.storagePath;
  }

  scan(projectPath: string): AISession[] {
    const sessions: AISession[] = [];
    
    // Check for main history file
    const historyFile = path.join(projectPath, '.aider.chat.history.md');
    if (fs.existsSync(historyFile)) {
      const session = this.parseSessionFile(historyFile, projectPath);
      if (session && session.changes.length > 0) {
        sessions.push(session);
      }
    }

    // Also check .aider directory for additional history
    const aiderDir = path.join(projectPath, '.aider');
    if (fs.existsSync(aiderDir)) {
      try {
        const files = glob.sync('**/*.md', { cwd: aiderDir });
        for (const file of files) {
          if (file.includes('history') || file.includes('chat')) {
            const session = this.parseSessionFile(path.join(aiderDir, file), projectPath);
            if (session && session.changes.length > 0) {
              sessions.push(session);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return sessions;
  }

  /**
   * Check if Aider history exists in the project
   */
  isAvailable(): boolean {
    // For Aider, we can't check globally - it's project-specific
    return true;
  }

  /**
   * Check if Aider history exists for a specific project
   */
  isAvailableForProject(projectPath: string): boolean {
    const historyFile = path.join(projectPath, this.storagePath);
    const aiderDir = path.join(projectPath, '.aider');
    return fs.existsSync(historyFile) || fs.existsSync(aiderDir);
  }

  parseSessionFile(filePath: string, projectPath: string): AISession | null {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    const changes: FileChange[] = [];
    const fileStats = fs.statSync(filePath);
    const sessionTimestamp = fileStats.mtime;

    // Parse the markdown content to find file changes
    // Aider uses various patterns:
    
    // Pattern 1: ```language path/to/file.py
    const codeBlockRegex = /```(\w+)?\s+([^\n`]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language, filePathRaw, code] = match;
      
      // Skip if it looks like a diff or command output
      if (filePathRaw.startsWith('>') || filePathRaw.startsWith('$') || filePathRaw.startsWith('#')) {
        continue;
      }

      // Clean up the file path
      const cleanPath = filePathRaw.trim();
      
      // Skip if path contains spaces (likely not a real path) or is too long
      if (!cleanPath || cleanPath.includes('  ') || cleanPath.length > 200) {
        continue;
      }
      
      // Skip common non-file patterns
      if (cleanPath.match(/^(bash|shell|console|output|diff|patch|error|warning|note|example)/i)) {
        continue;
      }

      const linesAdded = this.countLines(code);
      if (linesAdded > 0) {
        changes.push({
          filePath: this.normalizePath(cleanPath, projectPath),
          linesAdded,
          linesRemoved: 0,
          changeType: 'modify',
          timestamp: sessionTimestamp,
          tool: this.tool,
          content: code,
          addedLines: this.extractNonEmptyLines(code),
        });
      }
    }

    // Pattern 2: SEARCH/REPLACE blocks (Aider's edit format)
    // Look for file context before SEARCH/REPLACE
    const fileEditRegex = /(?:^|\n)([^\n]+\.[a-zA-Z]+)\n```[^\n]*\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
    
    while ((match = fileEditRegex.exec(content)) !== null) {
      const [, filePathRaw, searchContent, replaceContent] = match;
      const cleanPath = filePathRaw.trim();
      
      if (cleanPath && !cleanPath.includes(' ')) {
        const linesRemoved = this.countLines(searchContent);
        const linesAdded = this.countLines(replaceContent);

        if (linesAdded > 0 || linesRemoved > 0) {
          changes.push({
            filePath: this.normalizePath(cleanPath, projectPath),
            linesAdded,
            linesRemoved,
            changeType: 'modify',
            timestamp: sessionTimestamp,
            tool: this.tool,
            content: replaceContent,
            addedLines: this.extractNonEmptyLines(replaceContent),
          });
        }
      }
    }

    // Pattern 3: Standalone SEARCH/REPLACE without file context
    const standaloneEditRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
    
    while ((match = standaloneEditRegex.exec(content)) !== null) {
      const [fullMatch, searchContent, replaceContent] = match;
      
      // Skip if already captured by fileEditRegex
      if (content.indexOf(fullMatch) !== match.index) continue;
      
      const linesRemoved = this.countLines(searchContent);
      const linesAdded = this.countLines(replaceContent);

      if (linesAdded > 0 || linesRemoved > 0) {
        changes.push({
          filePath: 'unknown',
          linesAdded,
          linesRemoved,
          changeType: 'modify',
          timestamp: sessionTimestamp,
          tool: this.tool,
          content: replaceContent,
          addedLines: this.extractNonEmptyLines(replaceContent),
        });
      }
    }

    // Deduplicate changes by file path
    const uniqueChanges = this.deduplicateChanges(changes);

    if (uniqueChanges.length === 0) return null;

    return {
      id: this.generateSessionId(filePath),
      tool: this.tool,
      timestamp: sessionTimestamp,
      projectPath,
      changes: uniqueChanges,
      totalFilesChanged: new Set(uniqueChanges.map(c => c.filePath)).size,
      totalLinesAdded: uniqueChanges.reduce((sum, c) => sum + c.linesAdded, 0),
      totalLinesRemoved: uniqueChanges.reduce((sum, c) => sum + c.linesRemoved, 0),
    };
  }

  /**
   * Deduplicate changes, keeping the latest for each file
   */
  private deduplicateChanges(changes: FileChange[]): FileChange[] {
    const byFile = new Map<string, FileChange>();
    
    for (const change of changes) {
      const existing = byFile.get(change.filePath);
      if (!existing) {
        byFile.set(change.filePath, { ...change });
      } else {
        // Accumulate lines
        existing.linesAdded += change.linesAdded;
        existing.linesRemoved += change.linesRemoved;
        if (change.addedLines && change.addedLines.length > 0) {
          if (!existing.addedLines) {
            existing.addedLines = [];
          }
          existing.addedLines.push(...change.addedLines);
        }
      }
    }

    return Array.from(byFile.values()).filter(c => c.filePath !== 'unknown');
  }
}
