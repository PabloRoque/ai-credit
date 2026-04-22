import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { AISession, AITool, FileChange } from '../types.js';
import { BaseScanner } from './base.js';

/**
 * Scanner for Opencode (opencode.ai) sessions.
 *
 * Opencode stores all session data in a SQLite database:
 *   ~/.local/share/opencode/opencode.db
 *
 * Relevant tables:
 *   session  — id, directory, time_created, summary_additions, summary_deletions
 *   message  — session_id, time_created, data (JSON blob)
 *
 * File changes are recorded in message.data as:
 *   data.summary.diffs[] = { file, patch, additions, deletions, status }
 *
 * The model is recorded on user messages as:
 *   data.model.modelID
 */
export class OpencodeScanner extends BaseScanner {
  private nodeRequire = createRequire(import.meta.url);

  get tool(): AITool {
    return AITool.OPENCODE;
  }

  get storagePath(): string {
    return '~/.local/share/opencode/opencode.db';
  }

  isAvailable(): boolean {
    return fs.existsSync(this.resolveStoragePath());
  }

  scan(projectPath: string): AISession[] {
    const dbPath = this.resolveStoragePath();
    if (!fs.existsSync(dbPath)) return [];

    const normalizedProject = path.resolve(projectPath);
    const rows = this.queryDb(dbPath, normalizedProject);
    if (!rows) return [];

    const sessions: AISession[] = [];

    for (const row of rows) {
      const { sessionId, sessionDir, timeCreated, messagesJson } = row;

      if (!this.pathsMatch(sessionDir, normalizedProject)) continue;

      let messages: any[] = [];
      try {
        messages = JSON.parse(messagesJson);
      } catch {
        continue;
      }

      const changes: FileChange[] = [];
      let sessionModel: string | undefined;

      for (const msgData of messages) {
        if (!msgData || !Array.isArray(msgData.summary?.diffs)) continue;

        // Model is on the user message that triggered each turn
        const msgModel: string | undefined = msgData.model?.modelID ?? undefined;
        if (msgModel && !sessionModel) sessionModel = msgModel;

        const timestamp = msgData.time?.created
          ? new Date(msgData.time.created)
          : new Date(timeCreated);

        for (const diff of msgData.summary.diffs) {
          const change = this.parseDiff(diff, normalizedProject, timestamp, msgModel ?? sessionModel);
          if (change) changes.push(change);
        }
      }

      if (changes.length === 0) continue;

      const uniqueChanges = this.deduplicateChanges(changes);

      // Back-fill model on changes that didn't have one
      if (sessionModel) {
        for (const c of uniqueChanges) {
          if (!c.model) c.model = sessionModel;
        }
      }

      sessions.push({
        id: sessionId,
        tool: this.tool,
        model: sessionModel,
        timestamp: new Date(timeCreated),
        projectPath: normalizedProject,
        changes: uniqueChanges,
        totalFilesChanged: new Set(uniqueChanges.map(c => c.filePath)).size,
        totalLinesAdded: uniqueChanges.reduce((s, c) => s + c.linesAdded, 0),
        totalLinesRemoved: uniqueChanges.reduce((s, c) => s + c.linesRemoved, 0),
      });
    }

    return sessions;
  }

  /**
   * Not used — scanning is driven by the SQLite DB, not individual files.
   */
  parseSessionFile(_filePath: string, _projectPath: string): AISession | null {
    return null;
  }

  // ---------------------------------------------------------------------------
  // SQLite access — batch all queries into a single sql.js subprocess call
  // ---------------------------------------------------------------------------

  private queryDb(dbPath: string, projectPath: string): Array<{
    sessionId: string;
    sessionDir: string;
    timeCreated: number;
    messagesJson: string;
  }> | null {
    const sqlJsPath = this.getSqlJsEntryPath();
    if (!sqlJsPath) return null;

    // One subprocess: load the DB, fetch sessions + their messages with diffs,
    // return a JSON array of { sessionId, sessionDir, timeCreated, messagesJson }.
    const script = `
const initSqlJs = require(process.env.SQLJS_MODULE_PATH);
const fs = require('fs');
const pathMod = require('path');

const dbPath = process.env.OC_DB_PATH;
const projectPath = process.env.OC_PROJECT_PATH;

initSqlJs({ locateFile: file => pathMod.join(pathMod.dirname(process.env.SQLJS_MODULE_PATH), file) })
  .then(SQL => {
    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);

    // Fetch all sessions that recorded at least some activity
    const sessRes = db.exec(
      "SELECT id, directory, time_created FROM session WHERE summary_additions > 0 OR summary_deletions > 0 OR summary_files > 0"
    );

    const sessions = sessRes && sessRes[0] ? sessRes[0].values : [];
    const results = [];

    for (const [sessionId, sessionDir, timeCreated] of sessions) {
      // Fetch messages that carry diffs for this session
      const msgRes = db.exec(
        "SELECT data FROM message WHERE session_id='" + sessionId.replace(/'/g, "''") +
        "' AND json_array_length(json_extract(data, '$.summary.diffs')) > 0"
      );
      const msgRows = msgRes && msgRes[0] ? msgRes[0].values : [];
      if (msgRows.length === 0) continue;

      const messages = msgRows.map(r => {
        try { return JSON.parse(r[0]); } catch { return null; }
      }).filter(Boolean);

      if (messages.length === 0) continue;

      results.push({ sessionId, sessionDir, timeCreated, messagesJson: JSON.stringify(messages) });
    }

    process.stdout.write(JSON.stringify(results));
  })
  .catch(e => { process.stderr.write(String(e)); process.exit(1); });
`;

    try {
      const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          OC_DB_PATH: dbPath,
          OC_PROJECT_PATH: projectPath,
          SQLJS_MODULE_PATH: sqlJsPath,
        },
        maxBuffer: 1024 * 1024 * 64,
      });

      if (result.error || result.status !== 0) return null;

      const output = result.stdout?.toString() ?? '';
      if (!output) return null;

      return JSON.parse(output);
    } catch {
      return null;
    }
  }

  private getSqlJsEntryPath(): string | null {
    try {
      return this.nodeRequire.resolve('sql.js');
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Diff parsing
  // ---------------------------------------------------------------------------

  private parseDiff(diff: any, projectPath: string, timestamp: Date, model?: string): FileChange | null {
    if (!diff?.file) return null;

    const filePath = this.normalizePath(diff.file, projectPath);
    const status: string = diff.status ?? 'modified';

    const changeType: FileChange['changeType'] =
      status === 'added' ? 'create' :
      status === 'deleted' ? 'delete' :
      'modify';

    const linesAdded: number = typeof diff.additions === 'number' ? diff.additions : 0;
    const linesRemoved: number = typeof diff.deletions === 'number' ? diff.deletions : 0;

    // Extract added lines from the unified patch for content verification
    const addedLines = this.extractAddedLinesFromDiff(diff.patch);

    return {
      filePath,
      linesAdded,
      linesRemoved,
      changeType,
      timestamp,
      tool: this.tool,
      model,
      addedLines: addedLines.length > 0 ? addedLines : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private pathsMatch(sessionDir: string, projectPath: string): boolean {
    const s = this.toForwardSlash(path.resolve(sessionDir));
    const p = this.toForwardSlash(projectPath);
    return s === p || s.startsWith(p + '/') || p.startsWith(s + '/');
  }

  private deduplicateChanges(changes: FileChange[]): FileChange[] {
    const seen = new Set<string>();
    const unique: FileChange[] = [];
    for (const c of changes) {
      const key = `${c.filePath}|${c.linesAdded}|${c.linesRemoved}|${c.timestamp.getTime()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }
    return unique;
  }
}
