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
    return this.storagePath.replace('~', this.homeDir);
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
   * Normalize file path relative to project
   */
  protected normalizePath(filePath: string, projectPath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.relative(projectPath, filePath);
    }
    return filePath;
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
