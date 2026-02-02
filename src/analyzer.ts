import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  AISession,
  AITool,
  ContributionStats,
  FileChange,
  FileStats,
  ToolStats,
} from './types.js';
import {
  BaseScanner,
  ClaudeScanner,
  CodexScanner,
  GeminiScanner,
  OpencodeScanner,
} from './scanners/index.js';

type RepoFileInfo = {
  totalLines: number;
  nonEmptyLines: number;
  lineSet: Set<string>;
};

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
    const repoFileIndex = this.buildRepoFileIndex(repoFiles);
    const totalLines = this.sumRepoLines(repoFileIndex);

    // Filter sessions to those with verified contributions
    const verifiedSessions = sessions.filter(session => {
      for (const change of session.changes) {
        const fileInfo = repoFileIndex.get(change.filePath);
        if (this.countVerifiedAddedLines(change, fileInfo) > 0) {
          return true;
        }
      }
      return false;
    });

    // Compute statistics
    const byTool = this.computeToolStats(verifiedSessions, repoFileIndex);
    const byFile = this.computeFileStats(verifiedSessions, repoFileIndex);

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
      sessions: verifiedSessions,
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
   * Build a file index for verification and totals
   */
  private buildRepoFileIndex(files: string[]): Map<string, RepoFileInfo> {
    const index = new Map<string, RepoFileInfo>();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.projectPath, file), 'utf-8');
        const totalLines = content.split('\n').length;
        const normalizedLines = content.split(/\r?\n/);
        const nonEmptyLines = normalizedLines.filter(line => line.length > 0).length;
        const lineSet = new Set(normalizedLines.filter(line => line.length > 0));
        index.set(file, { totalLines, nonEmptyLines, lineSet });
      } catch {
        index.set(file, { totalLines: 0, nonEmptyLines: 0, lineSet: new Set() });
      }
    }

    return index;
  }

  /**
   * Sum total lines from the repository index
   */
  private sumRepoLines(repoFileIndex: Map<string, RepoFileInfo>): number {
    let total = 0;
    for (const info of repoFileIndex.values()) {
      total += info.totalLines;
    }
    return total;
  }

  /**
   * Split content into non-empty lines
   */
  private splitNonEmptyLines(content: string | undefined): string[] {
    if (!content) return [];
    return content.split(/\r?\n/).filter(line => line.length > 0);
  }

  /**
   * Get added lines from a change, falling back to content
   */
  private getAddedLines(change: FileChange): string[] {
    if (change.addedLines && change.addedLines.length > 0) {
      return change.addedLines;
    }
    if (change.content) {
      return this.splitNonEmptyLines(change.content);
    }
    return [];
  }

  /**
   * Count verified added lines that still exist in the repo file
   */
  private countVerifiedAddedLines(change: FileChange, fileInfo: RepoFileInfo | undefined): number {
    if (!fileInfo) return 0;
    const addedLines = this.getAddedLines(change);
    if (addedLines.length === 0) return 0;

    let matched = 0;
    for (const line of addedLines) {
      if (line.length === 0) continue;
      if (fileInfo.lineSet.has(line)) {
        matched++;
      }
    }

    if (change.linesAdded > 0) {
      return Math.min(matched, change.linesAdded);
    }

    return Math.min(matched, addedLines.length);
  }

  /**
   * Compute statistics by AI tool
   */
  private computeToolStats(sessions: AISession[], repoFileIndex: Map<string, RepoFileInfo>): Map<AITool, ToolStats> {
    const stats = new Map<AITool, ToolStats>();
    // Track unique files per tool across all sessions
    const filesByTool = new Map<AITool, Set<string>>();
    // Track unique files per model across all sessions
    const filesByModel = new Map<string, Set<string>>();

    for (const session of sessions) {
      const sessionContribs: Array<{ change: FileChange; verifiedAdded: number; modelName: string }> = [];

      for (const change of session.changes) {
        const fileInfo = repoFileIndex.get(change.filePath);
        const verifiedAdded = this.countVerifiedAddedLines(change, fileInfo);
        if (verifiedAdded <= 0) continue;
        const modelName = change.model || session.model || 'unknown';
        sessionContribs.push({ change, verifiedAdded, modelName });
      }

      if (sessionContribs.length === 0) {
        continue;
      }

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
          byModel: new Map(),
        };
        stats.set(session.tool, toolStats);
        filesByTool.set(session.tool, new Set());
      }

      toolStats.sessionsCount++;

      const toolFiles = filesByTool.get(session.tool)!;
      const modelsInSession = new Set<string>();

      for (const { change, verifiedAdded, modelName } of sessionContribs) {
        toolFiles.add(change.filePath);
        toolStats.linesAdded += verifiedAdded;
        toolStats.linesRemoved += change.linesRemoved;
        
        if (change.changeType === 'create') {
          toolStats.filesCreated++;
        } else {
          toolStats.filesModified++;
        }

        modelsInSession.add(modelName);

        // Aggregate by model
        let modelStats = toolStats.byModel.get(modelName);
        if (!modelStats) {
          modelStats = {
            model: modelName,
            sessionsCount: 0, // Will be counted below
            filesCreated: 0,
            filesModified: 0,
            totalFiles: 0,
            linesAdded: 0,
            linesRemoved: 0,
            netLines: 0,
          };
          toolStats.byModel.set(modelName, modelStats);
          filesByModel.set(`${session.tool}:${modelName}`, new Set());
        }

        const modelFiles = filesByModel.get(`${session.tool}:${modelName}`)!;
        modelFiles.add(change.filePath);
        modelStats.linesAdded += verifiedAdded;
        modelStats.linesRemoved += change.linesRemoved;

        if (change.changeType === 'create') {
          modelStats.filesCreated++;
        } else {
          modelStats.filesModified++;
        }
      }

      for (const modelName of modelsInSession) {
        const modelStats = toolStats.byModel.get(modelName);
        if (modelStats) {
          modelStats.sessionsCount++;
        }
      }
    }

    // Update totalFiles with unique count
    for (const [tool, toolStats] of stats) {
      toolStats.totalFiles = filesByTool.get(tool)?.size || 0;
      toolStats.netLines = toolStats.linesAdded - toolStats.linesRemoved;

      for (const [modelName, modelStats] of toolStats.byModel) {
        modelStats.totalFiles = filesByModel.get(`${tool}:${modelName}`)?.size || 0;
        modelStats.netLines = modelStats.linesAdded - modelStats.linesRemoved;
      }
    }

    return stats;
  }

  /**
   * Compute statistics by file
   */
  private computeFileStats(sessions: AISession[], repoFileIndex: Map<string, RepoFileInfo>): Map<string, FileStats> {
    const stats = new Map<string, FileStats>();

    // Initialize stats for all repo files
    for (const [file, info] of repoFileIndex) {
      stats.set(file, {
        filePath: file,
        totalLines: info.nonEmptyLines,
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

        const fileInfo = repoFileIndex.get(change.filePath);
        const verifiedAdded = this.countVerifiedAddedLines(change, fileInfo);
        fileStats.aiContributedLines += verifiedAdded;
        
        const currentToolContrib = fileStats.contributions.get(session.tool) || 0;
        fileStats.contributions.set(session.tool, currentToolContrib + verifiedAdded);
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
        // File was deleted but had AI contributions (cannot verify)
        fileStats.aiContributionRatio = 0;
      }
    }

    return stats;
  }
}
