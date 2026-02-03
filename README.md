# AI Contribution Tracker

[![npm version](https://img.shields.io/npm/v/ai-credit.svg)](https://www.npmjs.com/package/ai-credit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A command-line tool to track and analyze AI coding assistants' contributions in your codebase (macOS/Linux/Windows). Supports **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Opencode**.

<img width="700" height="700" alt="image" src="https://github.com/user-attachments/assets/48545b91-8d20-4946-bc1c-f55762c01539" />

## Quick Start

```bash
# Run directly with npx (no installation required)
npx ai-credit

# Or install globally
npm install -g ai-credit
ai-credit
```

## Features

- 🔍 **Auto-detection**: Automatically finds AI tool session data on your system (macOS/Linux/Windows)
- 📊 **Detailed Statistics**: Lines of code, files modified, contribution ratios
- 🤖 **Multi-tool Support**: Claude Code, Codex CLI, Gemini CLI, Opencode
- 📈 **Visual Reports**: Console, JSON, and Markdown output formats
- 📅 **Timeline View**: Track AI contributions over time
- 📁 **File-level Analysis**: See which files have the most AI contributions

## Usage

```bash
# Analyze current directory
npx ai-credit

# Analyze a specific repository
npx ai-credit /path/to/your/repo

# Export as JSON
npx ai-credit -f json -o report.json

# Only analyze specific tools
npx ai-credit -t claude,codex

# Show detailed file-level analysis
npx ai-credit -v
```

## Commands

### Main Analysis

```bash
npx ai-credit [path]

# Options:
#   -f, --format    Output format (console/json/markdown)
#   -o, --output    Output file path
#   -t, --tools     AI tools to analyze (claude,codex,gemini,opencode,all)
#   -v, --verbose   Show detailed output
```

### List Detected Tools

```bash
npx ai-credit list
```

Shows which AI tools have data available on your system:

```
🔍 Detected AI Tools

  Claude Code     ~/.claude/projects/              ✓ Available
  Codex CLI       ~/.codex/sessions/               ✓ Available
  Gemini CLI      ~/.gemini/tmp/                   ✗ Not found
  Opencode        ~/.local/share/opencode/         ✓ Available
```

### File-level Analysis

```bash
npx ai-credit files [path] [-n LIMIT]
```

Shows which files have the most AI contributions.

### Contribution History

```bash
npx ai-credit history [path] [-n LIMIT]
```

Shows a timeline of AI contributions.

### Session List

```bash
npx ai-credit sessions [path] [-t TOOL]
```

Lists all AI sessions for the repository.

## Output Example

```
ai-credit (main) npx ai-credit
Leave a 🌟 star if you like it: https://github.com/debugtheworldbot/ai-credit

╭──────────────────────────────────────────────────╮
│ AI Contribution Analysis                         │
│ Repository: /Users/eric/Developer/ai-credit      │
│ Scan time: 2/2/2026, 4:22:53 PM                  │
╰──────────────────────────────────────────────────╯
📊 Overview
┌─────────────┬───────┬─────────────────┐
│ Metric      │ Value │ AI Contribution │
├─────────────┼───────┼─────────────────┤
│ Total Files │ 18    │ 15 (83.3%)      │
├─────────────┼───────┼─────────────────┤
│ Total Lines │ 3496  │ 1660 (47.5%)    │
├─────────────┼───────┼─────────────────┤
│ AI Sessions │ 6     │ -               │
└─────────────┴───────┴─────────────────┘

🤖 Contribution by AI Tool
┌───────────────────────────────┬──────────┬───────┬─────────────┬───────────────┬──────────────────┐
│ Tool / Model                  │ Sessions │ Files │ Lines Added │ Lines Removed │ Share            │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│ Opencode                      │ 2        │ 12    │ +558        │ -128          │ 32.2%            │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│   └─ kimi-k2.5-free           │ 2        │ 12    │ +558        │ -128          │ 100.0% (of tool) │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│ Codex CLI                     │ 1        │ 11    │ +482        │ -303          │ 27.8%            │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│   └─ gpt-5.2-codex            │ 1        │ 11    │ +482        │ -303          │ 100.0% (of tool) │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│ Gemini CLI                    │ 2        │ 11    │ +357        │ -262          │ 20.6%            │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│   └─ gemini-2.5-pro           │ 1        │ 8     │ +330        │ -237          │ 92.4% (of tool)  │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│   └─ gemini-3-pro-preview     │ 1        │ 5     │ +27         │ -25           │ 7.6% (of tool)   │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│ Claude Code                   │ 1        │ 5     │ +338        │ -452          │ 19.5%            │
├───────────────────────────────┼──────────┼───────┼─────────────┼───────────────┼──────────────────┤
│   └─ claude-opus-4-5-20251101 │ 1        │ 5     │ +338        │ -452          │ 100.0% (of tool) │
└───────────────────────────────┴──────────┴───────┴─────────────┴───────────────┴──────────────────┘

📈 Contribution Distribution

  🟧🟧🟧🟧🟧🟧🟦🟦🟦🟦🟦🟪🟪🟪🟪🟪🟪🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜

  🟠 Opencode        15.3%  (534 lines)
  🔵 Codex CLI       13.2%  (461 lines)
  🟣 Gemini CLI       9.8%  (342 lines)
  🟢 Claude Code      9.2%  (323 lines)
  ⚪ Unknown/Human   52.5%  (1836 lines)
```

## Supported AI Tools

| Tool | Storage Location | Format |
|------|------------------|--------|
| Claude Code | `~/.claude/projects/<path>/` | JSONL |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/` | JSONL |
| Gemini CLI | `~/.gemini/tmp/<hash>/chats/` | JSON |
| Opencode | `~/.local/share/opencode/` | JSON |

## How It Works: The JSON Parsing Logic

`ai-credit`'s core is a multi-adapter parsing engine. It works by analyzing the session log files generated by different AI coding assistants. While each tool has a slightly different log format, they share a common pattern: recording interactions, especially AI tool calls (like file writing or editing), as structured data (JSON or JSONL). This tool identifies and parses these specific tool-call records to quantify code contributions.

Here's a detailed breakdown of the parsing method for each supported tool:

### 1. Claude Code

-   **File Format**: JSONL (`.jsonl`), one JSON object per line.
-   **Scan Path**: `~/.claude/projects/<path-encoded-project-name>/*.jsonl`
-   **Parsing Logic**:
    1.  The scanner iterates through all `.jsonl` session files in the project's directory.
    2.  It reads the file line by line, parsing each line into a JSON object.
    3.  The scanner focuses on log entries with `"type": "assistant"`, as these represent the AI's responses.
    4.  Within the assistant's response (`message.content` array), it looks for blocks of `"type": "tool_use"`. This indicates the AI decided to use a tool.
    5.  In the `tool_use` block, the `"name"` field identifies the specific action, such as `write`, `write_file`, or `edit_file`.
    6.  It extracts parameters from the `"input"` field, including:
        -   `path` or `file_path`: The target file path.
        -   `content` or `new_str`: The new content to be written or to replace existing content.
        -   `old_str`: (In edit operations only) The old content being replaced.

-   **Contribution Calculation**:
    -   **Lines Added**: Calculated by counting the lines in the `content` or `new_str`.
    -   **Lines Removed**: For edit operations, calculated by counting the lines in `old_str`.

**Example (Simplified Claude Code JSONL Entry):**

```json
{
  "timestamp": 1706860810000,
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "name": "write",
        "input": {
          "path": "src/main.py",
          "content": "def hello():\n    print(\"Hello, AI!\")\n"
        }
      }
    ]
  }
}
```

### 2. OpenAI Codex CLI

-   **File Format**: JSONL (`.jsonl`).
-   **Scan Path**: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
-   **Parsing Logic**:
    1.  The tool recursively scans the `sessions` directory for all `.jsonl` files.
    2.  In each JSON object, the scanner looks for a `"tool_calls"` array, which contains all tools called by the AI in that turn.
    3.  Each `tool_call` object contains a `"function"` field, where `"name"` specifies the function called (e.g., `write_file`, `apply_diff`) and `"arguments"` is a **JSON string** containing all parameters.
    4.  The scanner must first parse this `arguments` string into a JSON object.
    5.  From the parsed `arguments` object, it extracts the `path` (file path) and `content` (file content).

**Example (Simplified Codex CLI JSONL Entry):**

```json
{
  "timestamp": 1706947210000,
  "tool_calls": [
    {
      "function": {
        "name": "write_file",
        "arguments": "{\"path\": \"src/utils.py\", \"content\": \"def helper():\\n    return True\\n\"}"
      }
    }
  ]
}
```

### 3. Gemini CLI

-   **File Format**: JSON (`.json`), where one file represents a complete session.
-   **Scan Paths**: `~/.gemini/tmp/<hash>/chats/*.json`, `~/.gemini/history/*.json`, `~/.gemini/sessions/*.json`
-   **Parsing Logic**:
    1.  The scanner searches Gemini’s session JSON files under common locations (`tmp`, `history`, `sessions`).
    2.  It parses the entire JSON file, which typically contains a `"messages"` or `"turns"` array logging the conversation history.
    3.  It iterates through the `messages` array, looking for `"parts"` arrays within messages from the `"assistant"` role.
    4.  Within the `parts` array, it searches for an object containing a `"functionCall"` (or `toolCalls`). This object's structure is similar to Codex CLI.
    5.  It extracts the `"name"` (function name) and `"args"` (arguments dictionary) from the `functionCall` object.
    6.  **Project matching**: if the session JSON has an explicit project path (`projectPath/cwd/...`), it must match the target repo. If not, the scanner only keeps tool calls whose `file_path` is inside the target repo.

**Example (Simplified Gemini CLI JSON Fragment):**

```json
{
  "created_at": 1707033600000,
  "projectPath": "/home/ubuntu/my-project",
  "messages": [
    {
      "role": "assistant",
      "parts": [
        {
          "functionCall": {
            "name": "write_file",
            "args": {
              "path": "src/scanner.py",
              "content": "class Scanner:\n    pass\n"
            }
          }
        }
      ]
    }
  ]
}
```

### 4. Opencode

-   **File Format**: JSON (`.json`) session and message files.
-   **Scan Paths**:
    -   Sessions: `~/.local/share/opencode/storage/session/**/*.json`
    -   Messages: `~/.local/share/opencode/storage/message/<session-id>/*.json`
-   **Parsing Logic**:
    1.  The scanner reads all session JSON files (stored under project-hash subfolders).
    2.  It filters sessions by project path using `directory` or `projectPath` in the session metadata.
    3.  If message files exist for the session, it parses each message and looks for `summary.diffs`.
    4.  If no message-level diffs are found, it falls back to `summary.diffs` in the session file.
    5.  Each diff entry provides:
        -   `file`: relative file path
        -   `before`: previous content
        -   `after`: new content
        -   `additions` / `deletions`: optional precomputed line counts
    6.  Lines added/removed are taken from `additions`/`deletions` when present, otherwise computed from `before`/`after`.
    7.  The scanner also extracts the model from message data (e.g., `model.modelID`) when available.

**Example (Simplified Opencode Message JSON):**

```json
{
  "sessionID": "sess_abc123",
  "time": { "created": "2026-02-02T10:15:00Z" },
  "model": { "modelID": "kimi-k2.5-free" },
  "summary": {
    "diffs": [
      {
        "file": "src/index.ts",
        "before": "console.log('old');\n",
        "after": "console.log('new');\n",
        "additions": 1,
        "deletions": 1
      }
    ]
  }
}
```

### Summary

In essence, `ai-credit` features a specialized scanner for each supported AI tool. Each scanner is programmed to know its corresponding tool's log storage location and data structure. During analysis, the main program invokes all available scanners, collects all `FileChange` events related to the target project, and then aggregates, deduplicates, and analyzes these events to generate the final contribution report.

## Contribution Statistics Methodology

### Core Principle: Verified Existence

The tool applies a strict verification rule when calculating AI contribution statistics:

> **Only lines that currently exist in the codebase with exactly the same content are counted as AI contributions.**

### How It Works

1. **Parse AI Session Logs**: The scanner reads session files from each AI tool and extracts file change events (writes, edits, patches).

2. **Build Repository File Set**: The tool gathers repository files using text-file extensions, excluding common build/vendor folders and honoring the root `.gitignore`.

3. **Extract Changed Content**: For each file change, the tool captures:
   - The file path
   - Lines added (new content)
   - Lines removed (old content)

4. **Verify Against Current Codebase**: Before counting any line as an AI contribution, the tool:
   - Reads the current content of the target file from the repository
   - For each line that AI claims to have added, checks if an **identical line** exists in the current file
   - Only lines that match exactly (character-for-character) are counted

5. **Calculate Statistics**: The verified lines are then aggregated into:
   - Per-file contribution counts
   - Per-tool contribution totals
   - Overall repository contribution ratios
   - **Sessions, files, and models are counted only when at least one verified line exists**

### Example

If an AI tool's log shows it added these lines to `src/utils.py`:

```python
def helper():
    return True
```

But the current `src/utils.py` in the repository contains:

```python
def helper():
    return False  # Changed from True
```

Then the line `return True` will **NOT** be counted as an AI contribution because it no longer exists in the codebase. Only if the line matches exactly will it be included in the statistics.

### Why This Approach?

This methodology ensures that:
- Statistics reflect **actual, surviving** AI contributions
- Code that was later modified or removed by humans (or other AI tools) is not attributed to the original AI
- Contribution ratios are accurate and meaningful for understanding the current state of the codebase

## Limitations

- Only tracks AI contributions that are recorded in local session files
- Cannot detect AI-generated code that was copy-pasted manually
- Accuracy depends on the completeness of AI tool session logs
- Some AI tools may not record all file operations
- Files ignored by the root `.gitignore` are excluded from Total Files/Lines
- Windows support for some tools depends on their session storage format compatibility

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Adding Support for New AI Tools

1. Create a new scanner in `src/scanners/`
2. Extend the `BaseScanner` class
3. Implement `tool`, `storagePath`, `scan()`, and `parseSessionFile()` methods
4. Add the scanner to `analyzer.ts`

## License

MIT License - see [LICENSE](LICENSE) for details.
