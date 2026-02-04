import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { glob } from 'glob';
import ignore, { type Ignore } from 'ignore';
import {
  AISession,
  AITool,
  ContributionStats,
  FileChange,
  FileStats,
  ToolStats,
  VerificationMode,
} from './types.js';
import {
  BaseScanner,
  ClaudeScanner,
  CodexScanner,
  CursorScanner,
  GeminiScanner,
  OpencodeScanner,
} from './scanners/index.js';

type RepoFileInfo = {
  totalLines: number;
  nonEmptyLines: number;
  lineSet: Set<string>;
  normalizedLineSet: Set<string>;
};

/**
 * Main analyzer that coordinates all scanners and computes statistics
 */
export class ContributionAnalyzer {
  private projectPath: string;
  private scanners: BaseScanner[];
  private verificationMode: VerificationMode;

  constructor(projectPath: string, verificationMode: VerificationMode = 'relaxed') {
    this.projectPath = path.resolve(projectPath);
    this.verificationMode = verificationMode;
    this.scanners = [
      new ClaudeScanner(),
      new CodexScanner(),
      new CursorScanner(),
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
  analyze(tools?: AITool[], onProgress?: (filePath: string) => void): ContributionStats {
    const sessions = this.scanAllSessions(tools);
    
    // Get repository file stats
    const repoFiles = this.getRepoFiles();
    const repoFileSet = new Set(repoFiles);
    const filesNeedingLineSet = this.verificationMode === 'historical'
      ? undefined
      : new Set<string>();

    for (const session of sessions) {
      for (const change of session.changes) {
        if (filesNeedingLineSet && repoFileSet.has(change.filePath)) {
          filesNeedingLineSet.add(change.filePath);
        }
      }
    }

    const repoFileIndex = this.buildRepoFileIndex(repoFiles, filesNeedingLineSet, onProgress);
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
      verificationMode: this.verificationMode,
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
    const gitFiles = this.getRepoFilesFromGit();
    if (gitFiles.length > 0) {
      return gitFiles;
    }

    return this.getRepoFilesFromGlob();
  }

  private getRepoFilesFromGit(): string[] {
    const repoRoot = this.getGitRepoRoot();
    if (!repoRoot) {
      return [];
    }

    const relativeRoot = path.relative(repoRoot, this.projectPath);
    const normalizedRelativeRoot = this.normalizePathSegment(relativeRoot);
    const pathspec = normalizedRelativeRoot ? [normalizedRelativeRoot] : [];

    try {
      const tracked = this.runGitLsFiles(['ls-files', '-z', ...(pathspec.length > 0 ? ['--', ...pathspec] : [])]);
      const untracked = this.runGitLsFiles([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        ...(pathspec.length > 0 ? ['--', ...pathspec] : []),
      ]);
      const normalized = this.normalizeGitPaths([...tracked, ...untracked], normalizedRelativeRoot);
      return this.filterRepoFiles(normalized);
    } catch {
      return [];
    }
  }

  private getGitRepoRoot(): string | null {
    try {
      const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: this.projectPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return result.length > 0 ? result : null;
    } catch {
      return null;
    }
  }

  private runGitLsFiles(args: string[]): string[] {
    const output = execFileSync('git', args, {
      cwd: this.projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return output.split('\u0000').filter(Boolean);
  }

  private normalizeGitPaths(files: string[], projectRelativeToRepo: string | null): string[] {
    const normalized = files.map(file => this.toForwardSlash(file)).filter(Boolean);
    if (!projectRelativeToRepo) {
      return normalized;
    }

    const trimmedRoot = projectRelativeToRepo.replace(/\/+$/, '');
    if (!trimmedRoot) {
      return normalized;
    }

    const prefix = `${trimmedRoot}/`;
    const trimmed: string[] = [];
    for (const file of normalized) {
      if (file.startsWith(prefix)) {
        trimmed.push(file.slice(prefix.length));
      }
    }
    return trimmed;
  }

  private normalizePathSegment(segment: string): string | null {
    if (!segment || segment === '.' || segment === path.sep) {
      return null;
    }
    if (segment.startsWith('..')) {
      return null;
    }
    return this.toForwardSlash(segment);
  }

  private toForwardSlash(p: string): string {
    return p.replace(/\\/g, '/');
  }

  private getRepoFilesFromGlob(): string[] {
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
      return this.filterRepoFiles(files);
    } catch {
      return [];
    }
  }

  private filterRepoFiles(files: string[]): string[] {
    let filtered = files.map(file => file.replace(/\\/g, '/')).filter(Boolean);
    filtered = filtered.filter(file => !this.shouldIgnoreByDefault(file));
    filtered = filtered.filter(file => this.isTextFile(file));

    const gitignorePath = path.join(this.projectPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        const ignoreFactory = (ignore as unknown as { default?: () => Ignore }).default
          ?? (ignore as unknown as () => Ignore);
        const ig = ignoreFactory();
        ig.add(gitignoreContent.split(/\r?\n/));
        filtered = filtered.filter(file => !ig.ignores(file));
      } catch {
        // Ignore gitignore parsing errors
      }
    }

    return filtered;
  }

  private shouldIgnoreByDefault(file: string): boolean {
    const normalized = file.replace(/\\/g, '/');
    const wrapped = `/${normalized}`;

    if (wrapped.includes('/node_modules/')) return true;
    if (wrapped.includes('/.git/')) return true;
    if (wrapped.includes('/dist/')) return true;
    if (wrapped.includes('/build/')) return true;
    if (wrapped.includes('/__pycache__/')) return true;
    if (wrapped.includes('/venv/')) return true;
    if (wrapped.includes('/.venv/')) return true;
    if (wrapped.includes('/coverage/')) return true;
    if (wrapped.includes('/.next/')) return true;
    if (wrapped.includes('/.nuxt/')) return true;
    if (normalized.endsWith('.pyc')) return true;

    const base = path.posix.basename(normalized);
    if (base === 'package-lock.json') return true;
    if (base === 'pnpm-lock.yaml') return true;
    if (base === 'yarn.lock') return true;

    return false;
  }

  private isTextFile(file: string): boolean {
    const ext = path.extname(file).toLowerCase();
    const textExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
      '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
      '.c', '.cpp', '.h', '.hpp', '.cs',
      '.html', '.css', '.scss', '.less', '.sass',
      '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.xml',
      '.md', '.mdx', '.txt', '.rst',
      '.sh', '.bash', '.zsh', '.fish',
      '.sql', '.graphql', '.gql', '.graphqls',
      '.vue', '.svelte',
      '.php', '.swift', '.m',
      '.r', '.R', '.jl',
      '.ex', '.exs', '.erl', '.hrl',
      '.hs', '.elm', '.clj', '.cljs',
      '.dockerfile', '.tf', '.tfvars', '.hcl',
      '.proto', '.prisma', '.svg',
      '.ini', '.conf', '.cfg', '.properties',
      '.lock', '.gradle', '.groovy', '.kts',
      '.cmake', '.mk',
      '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
      '.csv', '.tsv',
    ];
    return textExtensions.includes(ext) || !ext;
  }

  /**
   * Build a file index for verification and totals
   */
  private buildRepoFileIndex(
    files: string[],
    filesNeedingLineSet?: Set<string>,
    onProgress?: (filePath: string) => void
  ): Map<string, RepoFileInfo> {
    const index = new Map<string, RepoFileInfo>();
    const emptyLineSet = new Set<string>();
    const emptyNormalizedLineSet = new Set<string>();

    for (const file of files) {
      if (onProgress) {
        onProgress(this.formatDisplayPath(file));
      }
      try {
        const content = fs.readFileSync(path.join(this.projectPath, file), 'utf-8');
        const normalizedLines = content.split(/\r?\n/);
        const totalLines = normalizedLines.length;
        let nonEmptyLines = 0;
        const buildLineSet = filesNeedingLineSet?.has(file) ?? false;
        const buildNormalizedLineSet = buildLineSet && this.verificationMode === 'relaxed';
        const lineSet = buildLineSet ? new Set<string>() : emptyLineSet;
        const normalizedLineSet = buildNormalizedLineSet ? new Set<string>() : emptyNormalizedLineSet;

        for (const line of normalizedLines) {
          if (line.length === 0) continue;
          nonEmptyLines++;
          if (buildLineSet) {
            lineSet.add(line);
          }
          if (buildNormalizedLineSet) {
            const normalized = this.normalizeLine(line);
            if (normalized.length > 0) {
              normalizedLineSet.add(normalized);
            }
          }
        }

        index.set(file, { totalLines, nonEmptyLines, lineSet, normalizedLineSet });
      } catch {
        index.set(file, {
          totalLines: 0,
          nonEmptyLines: 0,
          lineSet: emptyLineSet,
          normalizedLineSet: emptyNormalizedLineSet,
        });
      }
    }

    return index;
  }

  /**
   * Format a repo-relative path for display (include repo name).
   */
  private formatDisplayPath(repoRelativePath: string): string {
    const fullPath = path.join(this.projectPath, repoRelativePath);
    const displayPath = path.relative(path.dirname(this.projectPath), fullPath);
    return displayPath.replace(/\\/g, '/');
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
   * Normalize a line for relaxed matching (collapse whitespace)
   */
  private normalizeLine(line: string): string {
    return line.trim().replace(/\s+/g, ' ');
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
    const reportedAdded = change.linesAdded > 0 ? change.linesAdded : addedLines.length;

    if (this.verificationMode === 'historical') {
      if (reportedAdded <= 0) return 0;
      const cap = fileInfo.nonEmptyLines > 0 ? fileInfo.nonEmptyLines : fileInfo.totalLines;
      if (cap <= 0) return 0;
      return Math.min(reportedAdded, cap);
    }

    if (addedLines.length === 0) return 0;

    let matched = 0;
    for (const line of addedLines) {
      if (line.length === 0) continue;
      if (fileInfo.lineSet.has(line)) {
        matched++;
        continue;
      }
      if (this.verificationMode === 'relaxed') {
        const normalized = this.normalizeLine(line);
        if (normalized.length > 0 && fileInfo.normalizedLineSet.has(normalized)) {
          matched++;
        }
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
