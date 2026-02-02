#!/usr/bin/env node

import { Command } from 'commander';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { ContributionAnalyzer } from './analyzer.js';
import { ConsoleReporter, JsonReporter, MarkdownReporter } from './reporter.js';
import { AITool, OutputFormat } from './types.js';

// Worker thread: run analysis off the main thread so ora can animate
if (!isMainThread) {
  const { projectPath, tools } = workerData;
  const analyzer = new ContributionAnalyzer(projectPath);
  const stats = analyzer.analyze(tools);
  // ContributionStats contains Maps which can't be transferred directly
  // Serialize to JSON-safe format
  parentPort!.postMessage(JSON.stringify(stats, (_key, value) => {
    if (value instanceof Map) return { __type: 'Map', entries: Array.from(value.entries()) };
    return value;
  }));
  process.exit(0);
}

/**
 * Run analyzer in a worker thread to keep the main thread free for spinner animation
 */
function analyzeInWorker(projectPath: string, tools?: AITool[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { projectPath, tools },
    });
    worker.on('message', (msg: string) => {
      const parsed = JSON.parse(msg, (_key, value) => {
        if (value && value.__type === 'Map') return new Map(value.entries);
        return value;
      });
      // Restore Date objects from ISO strings
      if (parsed.scanTime) parsed.scanTime = new Date(parsed.scanTime);
      if (parsed.sessions) {
        for (const s of parsed.sessions) {
          if (s.timestamp) s.timestamp = new Date(s.timestamp);
          if (s.changes) for (const c of s.changes) { if (c.timestamp) c.timestamp = new Date(c.timestamp); }
        }
      }
      resolve(parsed);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

/**
 * Rainbow text animation (same algorithm as chalk-animation)
 * Each character gets a hue from a full rainbow spread across the string,
 * shifting by 5 degrees per frame for smooth flow.
 */
function rainbowText(str: string, frame: number): string {
  const len = str.length;
  if (len === 0) return str;
  let result = '';
  for (let i = 0; i < len; i++) {
    if (str[i] === ' ') { result += ' '; continue; }
    const hue = ((i / len) * 360 - frame * 5 % 360 + 360) % 360;
    const [r, g, b] = hsvToRgb(hue, 1, 1);
    result += chalk.rgb(r, g, b)(str[i]);
  }
  return result;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function startRainbowLoading(text: string) {
  let frame = 0;
  process.stderr.write('\u001B[?25l'); // hide cursor
  const interval = setInterval(() => {
    process.stderr.write(`\r${rainbowText(text, frame)}`);
    frame++;
  }, 15);
  return {
    stop() {
      clearInterval(interval);
      process.stderr.write(`\r${' '.repeat(text.length)}\r`);
      process.stderr.write('\u001B[?25h'); // show cursor
    },
    fail(msg: string) {
      clearInterval(interval);
      process.stderr.write(`\r${chalk.red('✖')} ${msg}\n`);
      process.stderr.write('\u001B[?25h');
    },
  };
}

const TOOL_MAP: Record<string, AITool> = {
  claude: AITool.CLAUDE_CODE,
  codex: AITool.CODEX,
  gemini: AITool.GEMINI,
  aider: AITool.AIDER,
  opencode: AITool.OPENCODE,
};

const TOOL_INFO: Record<AITool, { name: string; path: string }> = {
  [AITool.CLAUDE_CODE]: { name: 'Claude Code', path: '~/.claude/projects/' },
  [AITool.CODEX]: { name: 'Codex CLI', path: '~/.codex/sessions/' },
  [AITool.GEMINI]: { name: 'Gemini CLI', path: '~/.gemini/tmp/' },
  [AITool.AIDER]: { name: 'Aider', path: '.aider.chat.history.md' },
  [AITool.OPENCODE]: { name: 'Opencode', path: '~/.local/share/opencode/' },
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

    const spinner = startRainbowLoading('Analyzing repository...');

    try {
      const tools = parseTools(options.tools);
      const stats = await analyzeInWorker(resolvedPath, tools);

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
    const spinner = startRainbowLoading('Analyzing files...');

    try {
      const stats = await analyzeInWorker(resolvedPath);
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
    const spinner = startRainbowLoading('Loading history...');

    try {
      const stats = await analyzeInWorker(resolvedPath);
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
      [AITool.CLAUDE_CODE]: chalk.hex('#D97757'),
      [AITool.CODEX]: chalk.hex('#00A67E'),
      [AITool.GEMINI]: chalk.hex('#4796E3'),
      [AITool.AIDER]: chalk.hex('#D93B3B'),
      [AITool.OPENCODE]: chalk.yellow,
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

    const spinner = startRainbowLoading('Analyzing repository...');

    try {
      const tools = parseTools(options.tools);
      const stats = await analyzeInWorker(resolvedPath, tools);

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
