# BGA MCP Server - Copilot Instructions

This is a TypeScript MCP (Model Context Protocol) server for BoardGameArena (BGA) game development.

## Project Purpose
Provides AI assistants with tools to:
- Look up BGA Studio wiki documentation
- Read and analyze local BGA game project files
- Scaffold/generate BGA game code (states, actions, notifications, etc.)

## Key Technologies
- **Runtime**: Node.js with TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **HTTP client**: `axios` for wiki API calls
- **File system**: Node `fs` for local project file tools

## Project Structure
```
src/
  index.ts          - MCP server entry point
  tools/
    docs.ts         - BGA wiki documentation tools
    scaffold.ts     - Code generation / scaffolding tools (State classes)
    migrate.ts      - Migration tools (legacy → State classes)
    project.ts      - Local game project file tools
```

## BGA Development Notes
- BGA games use PHP for game logic (`Game.php`, `material.inc.php`)
- Modern BGA uses **State classes** in `modules/php/States/` (extends `Bga\GameFramework\States\GameState`)
- State types: `StateType::ACTIVE_PLAYER`, `MULTIPLE_ACTIVE_PLAYER`, `PRIVATE`, `GAME`
- Player actions are methods prefixed `act` and decorated with `#[PossibleAction]` inside State classes
- Actions return a transition name (string) or next state class name (e.g. `NextState::class`)
- `setupNewGame` returns the initial state class instead of calling `gamestate->changeStateLabel`
- Frontend uses `bgaPerformAction('actionName', { args })` and `bgaSetupPromiseNotifications`
- `states.inc.php` is no longer needed when fully using State classes
- BGA Studio wiki: https://en.doc.boardgamearena.com/Studio
- State classes docs: https://en.doc.boardgamearena.com/State_classes:_State_directory

## Development Guidelines
- Keep tools focused and well-documented
- Return structured JSON from all tools
- Handle errors gracefully with descriptive messages
- Use environment variables for any API keys
