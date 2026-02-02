import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AISession, AITool, FileChange } from '../types.js';

/**
 * Base class for AI tool scanners
 */
export abstract class BaseScanner {
  protected homeDir: string;
  
  constructor() {
    this.homeDir = os.homedir();
  }

  /**
   * The AI tool this scanner handles
   */
  abstract get tool(): AITool;

  /**
   * The storage path for this tool's session data
   */
  abstract get storagePath(): string;

  /**
   * Check if this tool has data available
   */
  isAvailable(): boolean {
    const fullPath = this.resolveStoragePath();
    return fs.existsSync(fullPath);
  }

  /**
   * Resolve the full storage path
   */
  protected resolveStoragePath(): string {
    return path.join(this.storagePath.replace('~', this.homeDir));
  }

  /**
   * Scan for sessions related to a specific project
   */
  abstract scan(projectPath: string): AISession[];

  /**
   * Parse a session file and extract file changes
   */
  abstract parseSessionFile(filePath: string, projectPath: string): AISession | null;

  /**
   * Count lines in a string
   */
  protected countLines(content: string | undefined): number {
    if (!content) return 0;
    return content.split('\n').filter(line => line.length > 0).length;
  }

  /**
   * Split content into lines, preserving whitespace
   */
  protected splitLines(content: string | undefined): string[] {
    if (!content) return [];
    return content.split(/\r?\n/);
  }

  /**
   * Extract non-empty lines from content
   */
  protected extractNonEmptyLines(content: string | undefined): string[] {
    return this.splitLines(content).filter(line => line.length > 0);
  }

  /**
   * Compute added lines using LCS diff (non-empty lines only)
   */
  protected diffAddedLines(before: string | undefined, after: string | undefined): string[] {
    const beforeLines = this.extractNonEmptyLines(before);
    const afterLines = this.extractNonEmptyLines(after);

    if (beforeLines.length === 0) return afterLines;
    if (afterLines.length === 0) return [];

    const m = beforeLines.length;
    const n = afterLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (beforeLines[i - 1] === afterLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const added: string[] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        added.push(afterLines[j - 1]);
        j--;
      }
    }
    while (j > 0) {
      added.push(afterLines[j - 1]);
      j--;
    }

    return added.reverse();
  }

  /**
   * Extract added lines from a unified diff
   */
  protected extractAddedLinesFromDiff(diff: string | undefined): string[] {
    if (!diff) return [];
    const lines = diff.split(/\r?\n/);
    const added: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.slice(1);
        if (content.length > 0) {
          added.push(content);
        }
      }
    }

    return added;
  }

  /**
   * Normalize separators to forward slashes (consistent with glob output)
   */
  protected toForwardSlash(p: string): string {
    return p.replace(/\\/g, '/');
  }

  /**
   * Normalize file path relative to project
   */
  protected normalizePath(filePath: string, projectPath: string): string {
    if (path.isAbsolute(filePath)) {
      return this.toForwardSlash(path.relative(projectPath, filePath));
    }
    return this.toForwardSlash(filePath);
  }

  /**
   * Check if a file path belongs to the project
   */
  protected isProjectFile(filePath: string, projectPath: string): boolean {
    const normalizedPath = this.normalizePath(filePath, projectPath);
    // Exclude paths that go outside the project
    return !normalizedPath.startsWith('..');
  }

  /**
   * Read and parse JSON file safely
   */
  protected readJsonFile(filePath: string): any {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Read and parse JSONL file safely
   */
  protected readJsonlFile(filePath: string): any[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Generate a unique session ID
   */
  protected generateSessionId(filePath: string): string {
    return `${this.tool}-${path.basename(filePath, path.extname(filePath))}`;
  }
}
