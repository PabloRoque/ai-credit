#!/usr/bin/env node

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { ContributionAnalyzer } from './analyzer.js';
import { ConsoleReporter, JsonReporter, MarkdownReporter } from './reporter.js';
import { AITool, OutputFormat } from './types.js';

const TOOL_MAP: Record<string, AITool> = {
  claude: AITool.CLAUDE_CODE,
  codex: AITool.CODEX,
  gemini: AITool.GEMINI,
  aider: AITool.AIDER,
};

const TOOL_INFO: Record<AITool, { name: string; path: string }> = {
  [AITool.CLAUDE_CODE]: { name: 'Claude Code', path: '~/.claude/projects/' },
  [AITool.CODEX]: { name: 'Codex CLI', path: '~/.codex/sessions/' },
  [AITool.GEMINI]: { name: 'Gemini CLI', path: '~/.gemini/tmp/' },
  [AITool.AIDER]: { name: 'Aider', path: '.aider.chat.history.md' },
};

/**
 * Parse tool string into array of AITool enums
 */
function parseTools(toolStr: string | undefined): AITool[] | undefined {
  if (!toolStr || toolStr.toLowerCase() === 'all') {
    return undefined;
  }

  const tools: AITool[] = [];
  for (const t of toolStr.toLowerCase().split(',')) {
    const trimmed = t.trim();
    if (trimmed in TOOL_MAP) {
      tools.push(TOOL_MAP[trimmed]);
    }
  }

  return tools.length > 0 ? tools : undefined;
}

const program = new Command();

program
  .name('ai-contrib')
  .description('CLI tool to track and analyze AI coding assistants\' contributions in your codebase')
  .version('1.0.0');

// Main scan command
program
  .command('scan [path]')
  .description('Scan repository for AI contributions')
  .option('-f, --format <format>', 'Output format (console, json, markdown)', 'console')
  .option('-o, --output <file>', 'Output file path (for json/markdown formats)')
  .option('-t, --tools <tools>', 'AI tools to analyze (claude,codex,gemini,aider or all)', 'all')
  .option('-v, --verbose', 'Show detailed output including files and timeline')
  .action(async (repoPath: string = '.', options) => {
    const resolvedPath = path.resolve(repoPath);

    if (!fs.existsSync(resolvedPath)) {
      console.error(chalk.red(`Error: Path '${repoPath}' does not exist.`));
      process.exit(1);
    }

    const spinner = ora('Analyzing repository...').start();

    try {
      const analyzer = new ContributionAnalyzer(resolvedPath);
      const tools = parseTools(options.tools);
      const stats = analyzer.analyze(tools);

      spinner.stop();

      const format = options.format as OutputFormat;

      if (format === 'console') {
        const reporter = new ConsoleReporter();
        reporter.printSummary(stats);
        
        if (options.verbose) {
          reporter.printFiles(stats);
          reporter.printTimeline(stats);
        }
      } else if (format === 'json') {
        const reporter = new JsonReporter();
        if (options.output) {
          reporter.save(stats, options.output);
          console.log(chalk.green(`Report saved to ${options.output}`));
        } else {
          console.log(reporter.generate(stats));
        }
      } else if (format === 'markdown') {
        const reporter = new MarkdownReporter();
        if (options.output) {
          reporter.save(stats, options.output);
          console.log(chalk.green(`Report saved to ${options.output}`));
        } else {
          console.log(reporter.generate(stats));
        }
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List detected AI tools with available data')
  .action(() => {
    console.log();
    console.log(chalk.bold('🔍 Detected AI Tools'));
    console.log();

    const analyzer = new ContributionAnalyzer('.');
    const available = analyzer.getAvailableTools();

    for (const tool of Object.values(AITool)) {
      const info = TOOL_INFO[tool];
      const status = available.includes(tool)
        ? chalk.green('✓ Available')
        : chalk.dim('✗ Not found');

      console.log(`  ${info.name.padEnd(15)} ${info.path.padEnd(30)} ${status}`);
    }

    console.log();
  });

// Files command
program
  .command('files [path]')
  .description('Show file-level AI contribution details')
  .option('-n, --limit <number>', 'Number of files to show', '20')
  .action(async (repoPath: string = '.', options) => {
    const resolvedPath = path.resolve(repoPath);
    const spinner = ora('Analyzing files...').start();

    try {
      const analyzer = new ContributionAnalyzer(resolvedPath);
      const stats = analyzer.analyze();
      spinner.stop();

      const reporter = new ConsoleReporter();
      reporter.printFiles(stats, parseInt(options.limit, 10));
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

// History command
program
  .command('history [path]')
  .description('Show AI contribution history/timeline')
  .option('-n, --limit <number>', 'Number of entries to show', '20')
  .action(async (repoPath: string = '.', options) => {
    const resolvedPath = path.resolve(repoPath);
    const spinner = ora('Loading history...').start();

    try {
      const analyzer = new ContributionAnalyzer(resolvedPath);
      const stats = analyzer.analyze();
      spinner.stop();

      const reporter = new ConsoleReporter();
      reporter.printTimeline(stats, parseInt(options.limit, 10));
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

// Sessions command
program
  .command('sessions [path]')
  .description('List all AI sessions for the repository')
  .option('-t, --tools <tools>', 'AI tools to include', 'all')
  .action(async (repoPath: string = '.', options) => {
    const resolvedPath = path.resolve(repoPath);

    const analyzer = new ContributionAnalyzer(resolvedPath);
    const tools = parseTools(options.tools);
    const sessions = analyzer.scanAllSessions(tools);

    console.log();
    console.log(chalk.bold(`📋 AI Sessions for ${resolvedPath}`));
    console.log();

    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions found.'));
      return;
    }

    const toolColors: Record<AITool, typeof chalk> = {
      [AITool.CLAUDE_CODE]: chalk.cyan,
      [AITool.CODEX]: chalk.green,
      [AITool.GEMINI]: chalk.blue,
      [AITool.AIDER]: chalk.magenta,
    };

    // Show last 20 sessions
    const recentSessions = sessions.slice(-20);
    for (const session of recentSessions) {
      const color = toolColors[session.tool] || chalk.white;
      const toolName = TOOL_INFO[session.tool].name;
      const date = session.timestamp.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      console.log(
        `  ${color(toolName.padEnd(12))} ` +
        `${chalk.dim(date)}  ` +
        `Files: ${session.totalFilesChanged.toString().padStart(3)}  ` +
        `Lines: ${chalk.green(`+${session.totalLinesAdded}`)}`
      );
    }

    console.log();
    console.log(chalk.dim(`Total: ${sessions.length} sessions`));
    console.log();
  });

// Default command (scan current directory)
program
  .argument('[path]', 'Repository path to analyze', '.')
  .option('-f, --format <format>', 'Output format (console, json, markdown)', 'console')
  .option('-o, --output <file>', 'Output file path')
  .option('-t, --tools <tools>', 'AI tools to analyze', 'all')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (repoPath: string, options) => {
    // If no subcommand is provided, run scan
    const resolvedPath = path.resolve(repoPath);

    if (!fs.existsSync(resolvedPath)) {
      console.error(chalk.red(`Error: Path '${repoPath}' does not exist.`));
      process.exit(1);
    }

    const spinner = ora('Analyzing repository...').start();

    try {
      const analyzer = new ContributionAnalyzer(resolvedPath);
      const tools = parseTools(options.tools);
      const stats = analyzer.analyze(tools);

      spinner.stop();

      const format = options.format as OutputFormat;

      if (format === 'console') {
        const reporter = new ConsoleReporter();
        reporter.printSummary(stats);
        
        if (options.verbose) {
          reporter.printFiles(stats);
          reporter.printTimeline(stats);
        }
      } else if (format === 'json') {
        const reporter = new JsonReporter();
        if (options.output) {
          reporter.save(stats, options.output);
          console.log(chalk.green(`Report saved to ${options.output}`));
        } else {
          console.log(reporter.generate(stats));
        }
      } else if (format === 'markdown') {
        const reporter = new MarkdownReporter();
        if (options.output) {
          reporter.save(stats, options.output);
          console.log(chalk.green(`Report saved to ${options.output}`));
        } else {
          console.log(reporter.generate(stats));
        }
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program.parse();
