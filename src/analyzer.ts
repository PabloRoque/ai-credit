import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  AISession,
  AITool,
  ContributionStats,
  FileStats,
  ToolStats,
} from './types.js';
import {
  BaseScanner,
  ClaudeScanner,
  CodexScanner,
  GeminiScanner,
  AiderScanner,
  OpencodeScanner,
} from './scanners/index.js';

/**
 * Main analyzer that coordinates all scanners and computes statistics
 */
export class ContributionAnalyzer {
  private projectPath: string;
  private scanners: BaseScanner[];

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.scanners = [
      new ClaudeScanner(),
      new CodexScanner(),
      new GeminiScanner(),
      new AiderScanner(),
      new OpencodeScanner(),
    ];
  }

  /**
   * Get list of available AI tools
   */
  getAvailableTools(): AITool[] {
    const available: AITool[] = [];
    
    for (const scanner of this.scanners) {
      if (scanner.isAvailable()) {
        available.push(scanner.tool);
      }
    }

    // Special check for Aider (project-local)
    const aiderScanner = this.scanners.find(s => s.tool === AITool.AIDER) as AiderScanner;
    if (aiderScanner?.isAvailableForProject(this.projectPath)) {
      if (!available.includes(AITool.AIDER)) {
        available.push(AITool.AIDER);
      }
    }

    return available;
  }

  /**
   * Scan all sessions from all tools
   */
  scanAllSessions(tools?: AITool[]): AISession[] {
    const sessions: AISession[] = [];

    for (const scanner of this.scanners) {
      if (tools && !tools.includes(scanner.tool)) {
        continue;
      }

      try {
        const toolSessions = scanner.scan(this.projectPath);
        sessions.push(...toolSessions);
      } catch (error) {
        // Silently ignore scanner errors
      }
    }

    // Sort by timestamp
    sessions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return sessions;
  }

  /**
   * Analyze the repository and compute contribution statistics
   */
  analyze(tools?: AITool[]): ContributionStats {
    const sessions = this.scanAllSessions(tools);
    
    // Get repository file stats
    const repoFiles = this.getRepoFiles();
    const totalLines = this.countTotalLines(repoFiles);

    // Compute statistics
    const byTool = this.computeToolStats(sessions);
    const byFile = this.computeFileStats(sessions, repoFiles);

    // Count AI-touched files and lines (only count files that exist in repo)
    let aiTouchedFiles = 0;
    let aiContributedLines = 0;

    for (const [filePath, stats] of byFile) {
      // Only count files that exist in the repo
      if (stats.aiContributedLines > 0 && repoFiles.includes(filePath)) {
        aiTouchedFiles++;
        // Cap contribution at actual file lines to avoid >100%
        aiContributedLines += Math.min(stats.aiContributedLines, stats.totalLines);
      }
    }

    return {
      repoPath: this.projectPath,
      scanTime: new Date(),
      totalFiles: repoFiles.length,
      totalLines,
      aiTouchedFiles,
      aiContributedLines,
      sessions,
      byTool,
      byFile,
    };
  }

  /**
   * Get all files in the repository (excluding common ignore patterns)
   */
  private getRepoFiles(): string[] {
    const ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/__pycache__/**',
      '**/*.pyc',
      '**/venv/**',
      '**/.venv/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/yarn.lock',
    ];

    try {
      const files = glob.sync('**/*', {
        cwd: this.projectPath,
        nodir: true,
        ignore: ignorePatterns,
      });

      // Filter to only include text files
      return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        const textExtensions = [
          '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
          '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
          '.c', '.cpp', '.h', '.hpp', '.cs',
          '.html', '.css', '.scss', '.less', '.sass',
          '.json', '.yaml', '.yml', '.toml', '.xml',
          '.md', '.txt', '.rst',
          '.sh', '.bash', '.zsh', '.fish',
          '.sql', '.graphql',
          '.vue', '.svelte',
          '.php', '.swift', '.m',
          '.r', '.R', '.jl',
          '.ex', '.exs', '.erl', '.hrl',
          '.hs', '.elm', '.clj', '.cljs',
          '.dockerfile', '.tf', '.hcl',
        ];
        return textExtensions.includes(ext) || !ext;
      });
    } catch {
      return [];
    }
  }

  /**
   * Count total lines in all repository files
   */
  private countTotalLines(files: string[]): number {
    let total = 0;

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.projectPath, file), 'utf-8');
        total += content.split('\n').length;
      } catch {
        // Ignore unreadable files
      }
    }

    return total;
  }

  /**
   * Compute statistics by AI tool
   */
  private computeToolStats(sessions: AISession[]): Map<AITool, ToolStats> {
    const stats = new Map<AITool, ToolStats>();
    // Track unique files per tool across all sessions
    const filesByTool = new Map<AITool, Set<string>>();

    for (const session of sessions) {
      let toolStats = stats.get(session.tool);
      
      if (!toolStats) {
        toolStats = {
          tool: session.tool,
          sessionsCount: 0,
          filesCreated: 0,
          filesModified: 0,
          totalFiles: 0,
          linesAdded: 0,
          linesRemoved: 0,
          netLines: 0,
        };
        stats.set(session.tool, toolStats);
        filesByTool.set(session.tool, new Set());
      }

      toolStats.sessionsCount++;
      
      const toolFiles = filesByTool.get(session.tool)!;
      for (const change of session.changes) {
        toolFiles.add(change.filePath);
        toolStats.linesAdded += change.linesAdded;
        toolStats.linesRemoved += change.linesRemoved;
        
        if (change.changeType === 'create') {
          toolStats.filesCreated++;
        } else {
          toolStats.filesModified++;
        }
      }
    }

    // Update totalFiles with unique count
    for (const [tool, toolStats] of stats) {
      toolStats.totalFiles = filesByTool.get(tool)?.size || 0;
      toolStats.netLines = toolStats.linesAdded - toolStats.linesRemoved;
    }

    return stats;
  }

  /**
   * Compute statistics by file
   */
  private computeFileStats(sessions: AISession[], repoFiles: string[]): Map<string, FileStats> {
    const stats = new Map<string, FileStats>();

    // Initialize stats for all repo files
    for (const file of repoFiles) {
      let totalLines = 0;
      try {
        const content = fs.readFileSync(path.join(this.projectPath, file), 'utf-8');
        totalLines = content.split('\n').length;
      } catch {
        // Ignore
      }

      stats.set(file, {
        filePath: file,
        totalLines,
        aiContributedLines: 0,
        aiContributionRatio: 0,
        contributions: new Map(),
      });
    }

    // Accumulate AI contributions
    for (const session of sessions) {
      for (const change of session.changes) {
        let fileStats = stats.get(change.filePath);
        
        if (!fileStats) {
          // File might have been deleted or renamed - still track it
          fileStats = {
            filePath: change.filePath,
            totalLines: 0,
            aiContributedLines: 0,
            aiContributionRatio: 0,
            contributions: new Map(),
          };
          stats.set(change.filePath, fileStats);
        }

        fileStats.aiContributedLines += change.linesAdded;
        
        const currentToolContrib = fileStats.contributions.get(session.tool) || 0;
        fileStats.contributions.set(session.tool, currentToolContrib + change.linesAdded);
      }
    }

    // Calculate ratios - cap at 100%
    for (const [, fileStats] of stats) {
      if (fileStats.totalLines > 0) {
        // Cap the ratio at 1.0 (100%)
        fileStats.aiContributionRatio = Math.min(
          fileStats.aiContributedLines / fileStats.totalLines,
          1.0
        );
      } else if (fileStats.aiContributedLines > 0) {
        // File was deleted but had AI contributions
        fileStats.aiContributionRatio = 1.0;
      }
    }

    return stats;
  }
}
