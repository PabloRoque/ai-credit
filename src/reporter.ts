import * as fs from 'fs';
import chalk from 'chalk';
import Table from 'cli-table3';
import { AITool, ContributionStats, FileStats, ToolStats } from './types.js';

/**
 * Tool display names
 */
const TOOL_NAMES: Record<AITool, string> = {
  [AITool.CLAUDE_CODE]: 'Claude Code',
  [AITool.CODEX]: 'Codex CLI',
  [AITool.GEMINI]: 'Gemini CLI',
  [AITool.OPENCODE]: 'Opencode',
};

/**
 * Tool colors for console output
 */
const TOOL_COLORS: Record<AITool, typeof chalk> = {
  [AITool.CLAUDE_CODE]: chalk.hex('#D97757'),
  [AITool.CODEX]: chalk.hex('#00A67E'),
  [AITool.GEMINI]: chalk.hex('#4796E3'),
  [AITool.OPENCODE]: chalk.yellow,
};

/**
 * Console reporter for terminal output
 */
export class ConsoleReporter {
  /**
   * Print the full summary report
   */
  printSummary(stats: ContributionStats): void {
    this.printHeader(stats);
    this.printOverview(stats);
    this.printToolBreakdown(stats);
    this.printDistributionBar(stats);
  }

  /**
   * Print report header
   */
  private printHeader(stats: ContributionStats): void {
    const boxWidth = 50;
    const title = 'AI Contribution Analysis';
    const repoLine = `Repository: ${stats.repoPath}`;
    const timeLine = `Scan time: ${stats.scanTime.toLocaleString()}`;

    console.log();
    console.log(chalk.cyan('╭' + '─'.repeat(boxWidth) + '╮'));
    console.log(chalk.cyan('│') + ' ' + chalk.bold(title.padEnd(boxWidth - 1)) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ' ' + repoLine.substring(0, boxWidth - 1).padEnd(boxWidth - 1) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ' ' + timeLine.padEnd(boxWidth - 1) + chalk.cyan('│'));
    console.log(chalk.cyan('╰' + '─'.repeat(boxWidth) + '╯'));
    console.log();
  }

  /**
   * Print overview statistics
   */
  private printOverview(stats: ContributionStats): void {
    console.log(chalk.bold('📊 Overview'));
    
    const table = new Table({
      head: ['Metric', 'Value', 'AI Contribution'].map(h => chalk.bold(h)),
      style: { head: [], border: [] },
    });

    const fileRatio = stats.totalFiles > 0 
      ? ((stats.aiTouchedFiles / stats.totalFiles) * 100).toFixed(1) 
      : '0.0';
    const lineRatio = stats.totalLines > 0 
      ? ((stats.aiContributedLines / stats.totalLines) * 100).toFixed(1) 
      : '0.0';

    table.push(
      ['Total Files', stats.totalFiles.toString(), `${stats.aiTouchedFiles} (${fileRatio}%)`],
      ['Total Lines', stats.totalLines.toString(), `${stats.aiContributedLines} (${lineRatio}%)`],
      ['AI Sessions', stats.sessions.length.toString(), '-'],
    );

    console.log(table.toString());
    console.log();
  }

  /**
   * Print breakdown by AI tool
   */
  private printToolBreakdown(stats: ContributionStats): void {
    if (stats.byTool.size === 0) {
      console.log(chalk.yellow('No AI contributions found.'));
      return;
    }

    console.log(chalk.bold('🤖 Contribution by AI Tool'));

    const table = new Table({
      head: ['Tool / Model', 'Sessions', 'Files', 'Lines Added', 'Lines Removed', 'Share'].map(h => chalk.bold(h)),
      style: { head: [], border: [] },
    });

    const totalLines = Array.from(stats.byTool.values())
      .reduce((sum, t) => sum + t.linesAdded, 0);

    const sortedTools = Array.from(stats.byTool.entries())
      .sort((a, b) => b[1].linesAdded - a[1].linesAdded);

    for (const [tool, toolStats] of sortedTools) {
      const share = totalLines > 0 
        ? ((toolStats.linesAdded / totalLines) * 100).toFixed(1) 
        : '0.0';
      const color = TOOL_COLORS[tool] || chalk.white;

      // Add tool row
      table.push([
        color(TOOL_NAMES[tool]),
        toolStats.sessionsCount.toString(),
        toolStats.totalFiles.toString(),
        chalk.green(`+${toolStats.linesAdded}`),
        chalk.red(`-${toolStats.linesRemoved}`),
        `${share}%`,
      ]);

      // Add model rows (if known and more than just "unknown" or if explicitly wanted)
      if (toolStats.byModel.size > 0) {
        // Sort models by lines added
        const sortedModels = Array.from(toolStats.byModel.entries())
          .sort((a, b) => b[1].linesAdded - a[1].linesAdded);

        for (const [modelName, modelStats] of sortedModels) {
           // Skip if model is 'unknown' and it's the only one (redundant)
           if (modelName === 'unknown' && toolStats.byModel.size === 1) continue;

           const modelShare = toolStats.linesAdded > 0
             ? ((modelStats.linesAdded / toolStats.linesAdded) * 100).toFixed(1)
             : '0.0';

           table.push([
             chalk.dim(`  └─ ${modelName}`),
             chalk.dim(modelStats.sessionsCount.toString()),
             chalk.dim(modelStats.totalFiles.toString()),
             chalk.dim(`+${modelStats.linesAdded}`),
             chalk.dim(`-${modelStats.linesRemoved}`),
             chalk.dim(`${modelShare}% (of tool)`),
           ]);
        }
      }
    }

    console.log(table.toString());
    console.log();
  }

  /**
   * Print distribution pie chart showing all code proportions
   */
  private printDistributionBar(stats: ContributionStats): void {
    if (stats.totalLines === 0) return;

    console.log(chalk.bold('📈 Contribution Distribution'));
    console.log();

    // Build slices: proportion each AI tool's share of repo lines + Unknown/Human
    const totalAILinesAdded = Array.from(stats.byTool.values())
      .reduce((sum, t) => sum + t.linesAdded, 0);

    const slices: { label: string; value: number; color: (s: string) => string }[] = [];

    const sortedTools = Array.from(stats.byTool.entries())
      .sort((a, b) => b[1].linesAdded - a[1].linesAdded);

    for (const [tool, toolStats] of sortedTools) {
      const toolRepoLines = totalAILinesAdded > 0
        ? Math.round(stats.aiContributedLines * (toolStats.linesAdded / totalAILinesAdded))
        : 0;
      if (toolRepoLines > 0) {
        const color = TOOL_COLORS[tool] || chalk.white;
        slices.push({ label: TOOL_NAMES[tool], value: toolRepoLines, color: (s: string) => color(s) });
      }
    }

    const humanLines = stats.totalLines - stats.aiContributedLines;
    if (humanLines > 0) {
      slices.push({ label: 'Unknown/Human', value: humanLines, color: (s: string) => chalk.gray(s) });
    }

    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) return;

    // Render stacked horizontal bar
    const barWidth = 60;
    let bar = '';
    const segments: { width: number; color: (s: string) => string }[] = [];

    for (const slice of slices) {
      const width = Math.max(1, Math.round((slice.value / total) * barWidth));
      segments.push({ width, color: slice.color });
    }

    // Adjust rounding so total width matches barWidth
    const totalWidth = segments.reduce((s, seg) => s + seg.width, 0);
    if (totalWidth !== barWidth && segments.length > 0) {
      segments[segments.length - 1].width += barWidth - totalWidth;
    }

    for (const seg of segments) {
      bar += seg.color('█'.repeat(seg.width));
    }

    console.log(`  ${bar}`);
    console.log();

    // Legend with percentage bars per slice
    for (const slice of slices) {
      const pct = (slice.value / total) * 100;
      const dot = slice.color('●');
      console.log(`  ${dot} ${slice.label.padEnd(14)} ${pct.toFixed(1).padStart(5)}%  (${slice.value} lines)`);
    }

    console.log();
  }

  /**
   * Print file-level statistics
   */
  printFiles(stats: ContributionStats, limit: number = 20): void {
    console.log(chalk.bold('                📁 Top AI-Contributed Files'));

    const table = new Table({
      head: ['File', 'Total Lines', 'AI Lines', 'AI Ratio', 'Contributors'].map(h => chalk.bold(h)),
      style: { head: [], border: [] },
      colWidths: [30, 12, 10, 10, 15],
    });

    // Sort files by AI contribution ratio
    const sortedFiles = Array.from(stats.byFile.entries())
      .filter(([, s]) => s.aiContributedLines > 0)
      .sort((a, b) => b[1].aiContributionRatio - a[1].aiContributionRatio)
      .slice(0, limit);

    for (const [filePath, fileStats] of sortedFiles) {
      const ratio = (fileStats.aiContributionRatio * 100).toFixed(1) + '%';
      const contributors = Array.from(fileStats.contributions.keys())
        .map(t => TOOL_NAMES[t])
        .join(', ');

      // Truncate long file paths
      const displayPath = filePath.length > 27 
        ? '...' + filePath.slice(-24) 
        : filePath;

      table.push([
        displayPath,
        fileStats.totalLines.toString(),
        fileStats.aiContributedLines.toString(),
        ratio,
        contributors.length > 12 ? contributors.slice(0, 12) + '...' : contributors,
      ]);
    }

    console.log(table.toString());
    console.log();
  }

  /**
   * Print timeline of AI activity
   */
  printTimeline(stats: ContributionStats, limit: number = 20): void {
    console.log(chalk.bold('                📅 Recent AI Activity'));

    const table = new Table({
      head: ['Date', 'Tool', 'Files', 'Changes'].map(h => chalk.bold(h)),
      style: { head: [], border: [] },
    });

    const recentSessions = stats.sessions.slice(-limit).reverse();

    for (const session of recentSessions) {
      const date = session.timestamp.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const color = TOOL_COLORS[session.tool] || chalk.white;

      table.push([
        chalk.dim(date),
        color(TOOL_NAMES[session.tool]),
        session.totalFilesChanged.toString(),
        chalk.green(`+${session.totalLinesAdded}`) + ' ' + chalk.red(`-${session.totalLinesRemoved}`),
      ]);
    }

    console.log(table.toString());
    console.log();
  }
}

/**
 * JSON reporter for structured output
 */
export class JsonReporter {
  /**
   * Generate JSON report
   */
  generate(stats: ContributionStats): string {
    const output = {
      repo_path: stats.repoPath,
      scan_time: stats.scanTime.toISOString(),
      overview: {
        total_files: stats.totalFiles,
        total_lines: stats.totalLines,
        ai_touched_files: stats.aiTouchedFiles,
        ai_contributed_lines: stats.aiContributedLines,
        ai_file_ratio: stats.totalFiles > 0 ? stats.aiTouchedFiles / stats.totalFiles : 0,
        ai_line_ratio: stats.totalLines > 0 ? stats.aiContributedLines / stats.totalLines : 0,
        total_sessions: stats.sessions.length,
      },
      by_tool: Object.fromEntries(
        Array.from(stats.byTool.entries())
          .sort((a, b) => b[1].linesAdded - a[1].linesAdded)
          .map(([tool, toolStats]) => [
          tool,
          {
            sessions_count: toolStats.sessionsCount,
            files_created: toolStats.filesCreated,
            files_modified: toolStats.filesModified,
            total_files: toolStats.totalFiles,
            lines_added: toolStats.linesAdded,
            lines_removed: toolStats.linesRemoved,
            net_lines: toolStats.netLines,
          },
        ])
      ),
      by_file: Object.fromEntries(
        Array.from(stats.byFile.entries())
          .filter(([, s]) => s.aiContributedLines > 0)
          .map(([filePath, fileStats]) => [
            filePath,
            {
              total_lines: fileStats.totalLines,
              ai_contributed_lines: fileStats.aiContributedLines,
              ai_contribution_ratio: fileStats.aiContributionRatio,
              contributions: Object.fromEntries(fileStats.contributions),
            },
          ])
      ),
    };

    return JSON.stringify(output, null, 2);
  }

  /**
   * Save JSON report to file
   */
  save(stats: ContributionStats, outputPath: string): void {
    const json = this.generate(stats);
    fs.writeFileSync(outputPath, json, 'utf-8');
  }
}

/**
 * Markdown reporter for documentation
 */
export class MarkdownReporter {
  /**
   * Generate Markdown report
   */
  generate(stats: ContributionStats): string {
    const lines: string[] = [];

    lines.push('# AI Contribution Report');
    lines.push('');
    lines.push(`**Repository:** \`${stats.repoPath}\``);
    lines.push(`**Generated:** ${stats.scanTime.toLocaleString()}`);
    lines.push('');

    // Overview
    lines.push('## Overview');
    lines.push('');
    lines.push('| Metric | Total | AI Contribution |');
    lines.push('|--------|-------|-----------------|');

    const fileRatio = stats.totalFiles > 0 
      ? ((stats.aiTouchedFiles / stats.totalFiles) * 100).toFixed(1) 
      : '0.0';
    const lineRatio = stats.totalLines > 0 
      ? ((stats.aiContributedLines / stats.totalLines) * 100).toFixed(1) 
      : '0.0';

    lines.push(`| Files | ${stats.totalFiles} | ${stats.aiTouchedFiles} (${fileRatio}%) |`);
    lines.push(`| Lines | ${stats.totalLines} | ${stats.aiContributedLines} (${lineRatio}%) |`);
    lines.push(`| Sessions | ${stats.sessions.length} | - |`);
    lines.push('');

    // By Tool
    if (stats.byTool.size > 0) {
      lines.push('## Contribution by AI Tool');
      lines.push('');
      lines.push('| Tool | Sessions | Files | Lines Added | Lines Removed | Share |');
      lines.push('|------|----------|-------|-------------|---------------|-------|');

      const totalLines = Array.from(stats.byTool.values())
        .reduce((sum, t) => sum + t.linesAdded, 0);

      const sortedTools = Array.from(stats.byTool.entries())
        .sort((a, b) => b[1].linesAdded - a[1].linesAdded);
      for (const [tool, toolStats] of sortedTools) {
        const share = totalLines > 0 
          ? ((toolStats.linesAdded / totalLines) * 100).toFixed(1) 
          : '0.0';

        lines.push(
          `| ${TOOL_NAMES[tool]} | ${toolStats.sessionsCount} | ${toolStats.totalFiles} | +${toolStats.linesAdded} | -${toolStats.linesRemoved} | ${share}% |`
        );
      }
      lines.push('');
    }

    // Top Files
    const topFiles = Array.from(stats.byFile.entries())
      .filter(([, s]) => s.aiContributedLines > 0)
      .sort((a, b) => b[1].aiContributionRatio - a[1].aiContributionRatio)
      .slice(0, 10);

    if (topFiles.length > 0) {
      lines.push('## Top AI-Contributed Files');
      lines.push('');
      lines.push('| File | Total Lines | AI Lines | AI Ratio |');
      lines.push('|------|-------------|----------|----------|');

      for (const [filePath, fileStats] of topFiles) {
        const ratio = (fileStats.aiContributionRatio * 100).toFixed(1) + '%';
        lines.push(`| \`${filePath}\` | ${fileStats.totalLines} | ${fileStats.aiContributedLines} | ${ratio} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Save Markdown report to file
   */
  save(stats: ContributionStats, outputPath: string): void {
    const markdown = this.generate(stats);
    fs.writeFileSync(outputPath, markdown, 'utf-8');
  }
}
