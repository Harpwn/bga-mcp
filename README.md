# BGA MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI assistants tools for **BoardGameArena (BGA)** game development.

## Features

| Category | Tools |
|----------|-------|
| **Documentation** | Search BGA Studio wiki, fetch specific wiki pages |
| **Scaffolding** | Generate State classes, actions, notifications, full game skeleton |
| **Migration** | Scan projects for deprecated patterns, convert states.inc.php, migration guide |
| **Local Project** | List files, read files, analyze states.inc.php, list player actions |

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
npm install
npm run build
```

## Usage

### Run the server

```bash
npm start
```

### Use with VS Code (MCP)

The `.vscode/mcp.json` file is already configured. After building, VS Code will automatically detect and start the server for use with GitHub Copilot and other MCP-compatible AI tools.

### Run the MCP Inspector

```bash
npm run inspector
```

## Available Tools

### Documentation
- **`bga_list_doc_pages`** – List all curated BGA Studio wiki pages available (grouped by category)
- **`bga_get_doc_page`** – Fetch a page by alias (e.g. `game_states`, `notifications`) or raw wiki page name

### Scaffolding
- **`bga_generate_state_class`** – Generate a modern PHP State class (`modules/php/States/ClassName.php`) using the new `GameState` base class and `#[PossibleAction]` attributes
- **`bga_generate_state_action`** – Generate an `#[PossibleAction]` method stub to add inside a State class
- **`bga_generate_notification`** – Generate PHP (backend) + JS (frontend) notification stubs using `bgaSetupPromiseNotifications`
- **`bga_scaffold_game`** – Generate a complete BGA game skeleton using the modern State classes approach

### Migration
- **`bga_migration_status`** – Scan a local project and report which files still use deprecated patterns (states.inc.php, self::checkAction, ajaxcall, notifqueue) vs the modern State classes approach
- **`bga_convert_states_inc`** – Read an existing `states.inc.php` and generate a modern PHP State class stub for every state in it
- **`bga_migration_guide`** – Return a step-by-step walkthrough for migrating from the legacy architecture to State classes

### Local Project
- **`bga_list_project_files`** – List files in a local BGA game directory
- **`bga_read_project_file`** – Read a file from a local project
- **`bga_analyze_game_states`** – Parse and summarize `states.inc.php`
- **`bga_list_player_actions`** – List PHP action methods in the main game class

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BGA_WORKSPACE_PATH` | Path to your BGA workspace root (set automatically via `.vscode/mcp.json`) |

## Project Structure

```
src/
  index.ts          Entry point – sets up MCP server and routes tool calls
  tools/
    docs.ts         BGA wiki documentation tools
    scaffold.ts     Code generation / scaffolding tools (State classes)
    migrate.ts      Migration tools (legacy → State classes)
    project.ts      Local game project file tools
```

## Development

```bash
npm run dev     # Watch mode (recompiles on save)
npm run build   # One-time build
```
