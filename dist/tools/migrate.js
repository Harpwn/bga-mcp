import fs from "fs";
import path from "path";
const WORKSPACE_PATH = process.env.BGA_WORKSPACE_PATH;
// ---------------------------------------------------------------------------
// Shared path resolution (mirrors project.ts)
// ---------------------------------------------------------------------------
function discoverGames(workspacePath) {
    try {
        return fs
            .readdirSync(workspacePath, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .filter((name) => {
            try {
                const files = fs.readdirSync(path.join(workspacePath, name));
                return (files.some((f) => f.endsWith(".game.php")) ||
                    files.includes("states.inc.php") ||
                    fs.existsSync(path.join(workspacePath, name, "modules", "php", "States")));
            }
            catch {
                return false;
            }
        });
    }
    catch {
        return [];
    }
}
function resolveProjectPath(args) {
    if (args.projectPath) {
        const p = args.projectPath;
        return { resolved: p, gameName: path.basename(p) };
    }
    if (!WORKSPACE_PATH)
        return { resolved: null, gameName: null };
    if (args.gameName) {
        const p = path.join(WORKSPACE_PATH, args.gameName);
        return { resolved: p, gameName: args.gameName };
    }
    const games = discoverGames(WORKSPACE_PATH);
    if (games.length === 1) {
        return { resolved: path.join(WORKSPACE_PATH, games[0]), gameName: games[0] };
    }
    return { resolved: null, gameName: null };
}
function noProjectPathError(multipleGames) {
    const text = multipleGames
        ? "Multiple BGA games found in the workspace. Pass a `gameName` argument (use `bga_list_games` to see available games)."
        : "No projectPath or gameName provided and no VS Code workspace detected. Please supply one.";
    return { content: [{ type: "text", text }], isError: true };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ucfirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
/** Convert a snake_case / camelCase state name to PascalCase class name */
function stateNameToClass(name) {
    // camelCase → PascalCase, or snake_case → PascalCase
    return name
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/^[a-z]/, (c) => c.toUpperCase());
}
/** Map old states.inc.php type strings to modern StateType enum values */
function mapStateType(oldType) {
    switch (oldType.toLowerCase()) {
        case "activeplayer": return "StateType::ACTIVE_PLAYER";
        case "multipleactiveplayer": return "StateType::MULTIPLE_ACTIVE_PLAYER";
        case "private": return "StateType::PRIVATE";
        case "game":
        case "manager":
        default: return "StateType::GAME";
    }
}
/** Parse all states from a states.inc.php content string */
function parseStatesInc(content) {
    const states = [];
    // Split into per-state blocks by matching the top-level numeric keys
    const blockRegex = /(\d+)\s*=>\s*\[([\s\S]*?)(?=\n\s*\d+\s*=>|\n\];|$)/g;
    let m;
    while ((m = blockRegex.exec(content)) !== null) {
        const id = parseInt(m[1], 10);
        const block = m[2];
        const get = (key) => block.match(new RegExp(`"${key}"\\s*=>\\s*"([^"]*)"`))?.[1] ?? "";
        const transMatch = block.match(/"transitions"\s*=>\s*\[([\s\S]*?)\]/);
        const transitions = {};
        if (transMatch) {
            for (const t of transMatch[1].matchAll(/"([^"]*)"\s*=>\s*(\d+)/g)) {
                transitions[t[1]] = parseInt(t[2], 10);
            }
        }
        const actionsMatch = block.match(/"possibleactions"\s*=>\s*\[([\s\S]*?)\]/);
        const possibleactions = [];
        if (actionsMatch) {
            for (const a of actionsMatch[1].matchAll(/"([^"]+)"/g)) {
                possibleactions.push(a[1]);
            }
        }
        states.push({
            id,
            name: get("name"),
            type: get("type"),
            description: get("description"),
            descriptionmyturn: get("descriptionmyturn"),
            transitions,
            possibleactions,
            action: get("action"),
        });
    }
    return states.filter((s) => s.name !== "");
}
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const projectPathProp = {
    type: "string",
    description: "Absolute path to the BGA game project root (overrides gameName).",
};
const gameNameProp = {
    type: "string",
    description: WORKSPACE_PATH
        ? `Name of the game subfolder inside the workspace. Auto-selected when only one game is present.`
        : "Name of the game subfolder within the games workspace directory.",
};
export const migrateTools = [
    {
        name: "bga_migration_status",
        description: "Scan a local BGA project and report its migration status: which files still use deprecated patterns (states.inc.php, self::checkAction, notifqueue) vs the modern State classes approach.",
        inputSchema: {
            type: "object",
            properties: {
                projectPath: projectPathProp,
                gameName: gameNameProp,
            },
            required: [],
        },
    },
    {
        name: "bga_convert_states_inc",
        description: "Read an existing states.inc.php from a local project and generate a modern PHP State class stub for each state defined in it. Skips the reserved gameSetup (id=1) and gameEnd (id=99) states.",
        inputSchema: {
            type: "object",
            properties: {
                projectPath: projectPathProp,
                gameName: gameNameProp,
                gameNamePascal: {
                    type: "string",
                    description: "PascalCase game name for PHP namespaces (e.g. 'MyGame'). Inferred from gameName/projectPath if omitted.",
                },
            },
            required: [],
        },
    },
    {
        name: "bga_migration_guide",
        description: "Return a step-by-step guide for migrating an existing BGA game from the legacy states.inc.php + self::checkAction pattern to the modern State classes architecture.",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
];
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
export async function handleMigrateTool(name, args) {
    if (name === "bga_migration_status")
        return migrationStatus(args);
    if (name === "bga_convert_states_inc")
        return convertStatesInc(args);
    if (name === "bga_migration_guide")
        return migrationGuide();
    return { content: [{ type: "text", text: `Unknown migrate tool: ${name}` }], isError: true };
}
// ---------------------------------------------------------------------------
function migrationStatus(args) {
    const { resolved: projectPath, gameName } = resolveProjectPath(args);
    if (!projectPath) {
        const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
        return noProjectPathError(games.length > 1);
    }
    const issues = [];
    const done = [];
    const info = [];
    // ---- states.inc.php -------------------------------------------------------
    const statesFile = path.join(projectPath, "states.inc.php");
    let parsedStates = [];
    if (fs.existsSync(statesFile)) {
        issues.push("**`states.inc.php` exists** — states are defined as old-style PHP arrays. Each non-reserved state should be converted to a State class.");
        try {
            parsedStates = parseStatesInc(fs.readFileSync(statesFile, "utf-8"));
            const migratable = parsedStates.filter((s) => s.id !== 1 && s.id !== 99);
            if (migratable.length > 0) {
                info.push(`  - States to convert: ${migratable.map((s) => `\`${s.name}\` (id=${s.id})`).join(", ")}`);
                info.push(`  - Use **\`bga_convert_states_inc\`** to generate all State class stubs at once.`);
            }
        }
        catch {
            info.push("  - Could not parse states.inc.php to enumerate states.");
        }
    }
    else {
        done.push("`states.inc.php` not found — states are likely managed via State classes already.");
    }
    // ---- modules/php/States/ --------------------------------------------------
    const statesDir = path.join(projectPath, "modules", "php", "States");
    if (fs.existsSync(statesDir)) {
        const classFiles = fs.readdirSync(statesDir).filter((f) => f.endsWith(".php"));
        if (classFiles.length > 0) {
            done.push(`\`modules/php/States/\` exists with ${classFiles.length} State class file(s): ${classFiles.map((f) => `\`${f}\``).join(", ")}`);
        }
        else {
            info.push("`modules/php/States/` directory exists but is empty — no State classes yet.");
        }
    }
    else {
        if (parsedStates.length > 0) {
            issues.push("`modules/php/States/` directory does not exist — create it and add State classes.");
        }
    }
    // ---- Game.php / *.game.php ------------------------------------------------
    const files = fs.readdirSync(projectPath);
    // Old Game.php or *.game.php
    const gamePhpCandidates = ["Game.php", ...files.filter((f) => f.endsWith(".game.php"))];
    for (const candidate of gamePhpCandidates) {
        const phpPath = path.join(projectPath, candidate);
        if (!fs.existsSync(phpPath))
            continue;
        const phpContent = fs.readFileSync(phpPath, "utf-8");
        // checkAction
        const checkActionCount = (phpContent.match(/checkAction\s*\(/g) ?? []).length;
        if (checkActionCount > 0) {
            issues.push(`**\`${candidate}\`** contains ${checkActionCount} \`checkAction()\` call(s) — these belong in the old player action pattern. Move actions into State classes with \`#[PossibleAction]\`.`);
        }
        // gamestate->nextState
        const nextStateCount = (phpContent.match(/gamestate\s*->\s*nextState\s*\(/g) ?? []).length;
        if (nextStateCount > 0) {
            issues.push(`**\`${candidate}\`** calls \`gamestate->nextState()\` ${nextStateCount} time(s) — State class actions should return a transition string or class name directly.`);
        }
        // setupNewGame return
        const setupNewGameMatch = phpContent.match(/function\s+setupNewGame[\s\S]{0,500}?return\s+([^;]+);/);
        if (setupNewGameMatch) {
            const ret = setupNewGameMatch[1].trim();
            if (ret.includes("::class")) {
                done.push(`\`${candidate}\` — \`setupNewGame\` returns \`${ret}\` (modern State class pattern ✓)`);
            }
            else {
                issues.push(`**\`${candidate}\`** — \`setupNewGame\` does not return an initial State class. Modern pattern: \`return PlayerTurn::class;\``);
            }
        }
        else {
            // setupNewGame with no return is also old
            if (phpContent.includes("setupNewGame")) {
                issues.push(`**\`${candidate}\`** — \`setupNewGame\` has no \`return\` statement. Modern pattern: \`return PlayerTurn::class;\``);
            }
        }
        // #[PossibleAction]
        const possibleActionCount = (phpContent.match(/#\[PossibleAction\]/g) ?? []).length;
        if (possibleActionCount > 0) {
            done.push(`\`${candidate}\` uses \`#[PossibleAction]\` (${possibleActionCount} occurrence(s)) — modern action pattern detected ✓`);
        }
        break; // only check first game PHP file
    }
    // ---- State class files — scan for PossibleAction ------------------------
    if (fs.existsSync(statesDir)) {
        const classFiles = fs.readdirSync(statesDir).filter((f) => f.endsWith(".php"));
        let totalPossibleActions = 0;
        for (const cf of classFiles) {
            const cfContent = fs.readFileSync(path.join(statesDir, cf), "utf-8");
            totalPossibleActions += (cfContent.match(/#\[PossibleAction\]/g) ?? []).length;
        }
        if (totalPossibleActions > 0) {
            done.push(`State class files contain ${totalPossibleActions} \`#[PossibleAction]\` method(s) ✓`);
        }
    }
    // ---- JS file --------------------------------------------------------------
    const jsFile = files.find((f) => f.endsWith(".js") && !f.includes(".min.") && f !== "Gruntfile.js");
    if (jsFile) {
        const jsContent = fs.readFileSync(path.join(projectPath, jsFile), "utf-8");
        const notifQueueCount = (jsContent.match(/notifqueue\.subscribe/g) ?? []).length;
        if (notifQueueCount > 0) {
            issues.push(`**\`${jsFile}\`** uses \`notifqueue.subscribe\` (${notifQueueCount} call(s)) — old notification pattern. Replace with \`bgaSetupPromiseNotifications({ ... })\`.`);
        }
        const bgaNotifCount = (jsContent.match(/bgaSetupPromiseNotifications/g) ?? []).length;
        if (bgaNotifCount > 0) {
            done.push(`\`${jsFile}\` uses \`bgaSetupPromiseNotifications\` (${bgaNotifCount} call(s)) — modern notification pattern ✓`);
        }
        const ajaxcallCount = (jsContent.match(/ajaxcall\s*\(/g) ?? []).length;
        if (ajaxcallCount > 0) {
            issues.push(`**\`${jsFile}\`** uses \`ajaxcall()\` (${ajaxcallCount} call(s)) — old action invocation. Replace with \`bgaPerformAction('actionName', { ... })\`.`);
        }
        const bgaPerformCount = (jsContent.match(/bgaPerformAction\s*\(/g) ?? []).length;
        if (bgaPerformCount > 0) {
            done.push(`\`${jsFile}\` uses \`bgaPerformAction\` (${bgaPerformCount} call(s)) — modern action invocation pattern ✓`);
        }
    }
    // ---- Summary -------------------------------------------------------------
    const lines = [`# Migration Status: \`${gameName}\`\n`];
    if (issues.length === 0 && done.length > 0) {
        lines.push("**Status: Fully migrated to State classes** ✅\n");
    }
    else if (issues.length > 0 && done.length === 0) {
        lines.push("**Status: Not yet started** ⛔ — no modern patterns detected\n");
    }
    else {
        lines.push(`**Status: Partially migrated** ⚠️ — ${issues.length} issue(s) remaining\n`);
    }
    if (done.length > 0) {
        lines.push("## Already Modern ✅");
        lines.push(done.map((d) => `- ${d}`).join("\n"));
        lines.push("");
    }
    if (info.length > 0) {
        lines.push("## Details");
        lines.push(info.join("\n"));
        lines.push("");
    }
    if (issues.length > 0) {
        lines.push("## Needs Migration ⚠️");
        lines.push(issues.map((i) => `- ${i}`).join("\n"));
        lines.push("\n> Run **`bga_migration_guide`** for a step-by-step walkthrough, or **`bga_convert_states_inc`** to auto-generate State class stubs from your existing `states.inc.php`.");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
// ---------------------------------------------------------------------------
function convertStatesInc(args) {
    const { resolved: projectPath, gameName } = resolveProjectPath(args);
    if (!projectPath) {
        const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
        return noProjectPathError(games.length > 1);
    }
    const rawPascal = args.gameNamePascal ?? ucfirst(gameName ?? "Game");
    const gameNamePascal = stateNameToClass(rawPascal);
    const statesFile = path.join(projectPath, "states.inc.php");
    if (!fs.existsSync(statesFile)) {
        return {
            content: [{ type: "text", text: `No \`states.inc.php\` found in \`${projectPath}\`. This project may already be using State classes.` }],
            isError: true,
        };
    }
    let content;
    try {
        content = fs.readFileSync(statesFile, "utf-8");
    }
    catch (err) {
        return { content: [{ type: "text", text: `Could not read states.inc.php: ${err}` }], isError: true };
    }
    const states = parseStatesInc(content);
    const migratable = states.filter((s) => s.id !== 1 && s.id !== 99);
    if (migratable.length === 0) {
        return {
            content: [{ type: "text", text: "No migratable states found in states.inc.php (only reserved gameSetup/gameEnd states detected)." }],
        };
    }
    // Build a map of id -> class name so transitions can reference classes
    const idToClass = {};
    for (const s of migratable) {
        idToClass[s.id] = stateNameToClass(s.name);
    }
    const files = migratable.map((s) => {
        const className = stateNameToClass(s.name);
        const stateType = mapStateType(s.type);
        const isPlayerState = s.type === "activeplayer" || s.type === "multipleactiveplayer";
        // Transitions
        const transEntries = Object.entries(s.transitions);
        const transPhp = transEntries.length > 0
            ? `            transitions: [\n${transEntries.map(([k, v]) => `                '${k}' => ${v},`).join("\n")}\n            ],`
            : `            transitions: [],`;
        // Descriptions
        const descLines = isPlayerState
            ? `            description: clienttranslate('${s.description || "${actplayer} must act"}'),\n            descriptionMyTurn: clienttranslate('${s.descriptionmyturn || "${you} must act"}'),`
            : `            description: '',`;
        // Action stubs
        const actionStubs = s.possibleactions.map((a) => {
            const method = `act${ucfirst(a)}`;
            // Try to work out a sensible default transition
            const defaultTransition = transEntries.length === 1
                ? `'${transEntries[0][0]}'`
                : transEntries.length > 1
                    ? `'${transEntries[0][0]}' // or: ${transEntries.slice(1).map(([k]) => `'${k}'`).join(", ")}`
                    : `'TODO'`;
            return `
    #[PossibleAction]
    public function ${method}(int $activePlayerId): string
    {
        $game = $this->game;

        // TODO: implement ${method} (migrated from old action method in *.game.php)

        return ${defaultTransition};
    }`;
        }).join("\n");
        // onEnteringState — mention old "action" if it was set
        const enteringBody = s.action
            ? `        // TODO: migrate logic from \`${s.action}()\` in *.game.php`
            : `        // TODO: called when entering this state`;
        // zombie only for player states
        const zombieMethod = isPlayerState
            ? `\n\n    public function zombie(int $playerId): string\n    {\n        // TODO: handle zombie (disconnected player)\n        return '${transEntries[0]?.[0] ?? "TODO"}';\n    }` : "";
        const php = `<?php
declare(strict_types=1);

namespace Bga\\Games\\${gameNamePascal}\\States;

use Bga\\GameFramework\\StateType;
use Bga\\GameFramework\\States\\GameState;
use Bga\\GameFramework\\States\\PossibleAction;
use Bga\\Games\\${gameNamePascal}\\Game;

/**
 * Migrated from states.inc.php state id ${s.id} ("${s.name}")
 */
class ${className} extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: ${s.id},
            type: ${stateType},
${descLines}
${transPhp}
        );
    }

    public function getArgs(int $activePlayerId): array
    {
        return [
            // TODO: migrate data from old arg method (if any)
        ];
    }

    public function onEnteringState(int $activePlayerId): void
    {
${enteringBody}
    }
${actionStubs}${zombieMethod}
}
`;
        return { path: `modules/php/States/${className}.php`, className, stateId: s.id, stateName: s.name, php };
    });
    // Also generate a note about updating setupNewGame
    const firstClass = files[0]?.className ?? "PlayerTurn";
    const setupNote = `## Update \`Game.php\` / \`*.game.php\`

In \`setupNewGame\`, return the initial state class instead of calling \`gamestate->changeState\`:

\`\`\`php
protected function setupNewGame(array $players, array $options = []): mixed
{
    // ... existing setup logic ...
    return ${firstClass}::class;
}
\`\`\`

Once all states are migrated and \`states.inc.php\` is no longer referenced, you can **delete it**.`;
    const sections = files.map((f) => `### \`${f.path}\`\n*(migrated from state id ${f.stateId}: \`${f.stateName}\`)*\n\`\`\`php\n${f.php}\`\`\``);
    const header = `# State Class Migration: \`${gameName}\`\n\nGenerated **${files.length}** State class stub(s) from \`states.inc.php\`.\nSave each file to \`${projectPath}/\` (relative paths shown above).\n\n---\n\n`;
    return {
        content: [
            {
                type: "text",
                text: header + sections.join("\n\n---\n\n") + "\n\n---\n\n" + setupNote,
            },
        ],
    };
}
// ---------------------------------------------------------------------------
function migrationGuide() {
    const guide = `# BGA State Classes Migration Guide

This guide explains how to migrate a BGA game from the legacy \`states.inc.php\` + \`self::checkAction\` architecture to the modern **State classes** approach.

---

## Overview of changes

| Old pattern | Modern pattern |
|---|---|
| \`states.inc.php\` PHP array | PHP class in \`modules/php/States/\` extending \`GameState\` |
| \`"possibleactions" => ["actPlayCard"]\` | \`#[PossibleAction]\` attribute on method |
| \`self::checkAction("actPlayCard")\` | Handled automatically by the framework |
| \`$this->gamestate->nextState("transition")\` | \`return 'transition';\` (or \`return NextState::class;\`) |
| \`function stNextPlayer() { ... }\` in Game.php | \`onEnteringState()\` / \`onEnteringState(): string\` in State class |
| \`"args" => "argPlayerTurn"\` | \`getArgs(int $activePlayerId): array\` in State class |
| \`ajaxcall('/game/action.html', ...)\` in JS | \`bgaPerformAction('actionName', { ... })\` in JS |
| \`notifqueue.subscribe('notif', this, 'handler')\` | \`bgaSetupPromiseNotifications({ notif: async (n) => { } })\` |

---

## Step-by-step migration

### Step 1 — Create the State classes directory

\`\`\`
mkdir modules/php/States
\`\`\`

### Step 2 — Generate State class stubs

Use **\`bga_convert_states_inc\`** to automatically generate a PHP State class stub for every state in your \`states.inc.php\`. Review and fill in the TODOs.

Alternatively, use **\`bga_generate_state_class\`** to generate individual states.

### Step 3 — Migrate state action (\`action\`) functions

For each state that had an \`"action" => "stFunctionName"\` key in \`states.inc.php\`:

1. Find \`stFunctionName()\` in your \`Game.php\` (or \`*.game.php\`)
2. Move the logic into \`onEnteringState()\` of the corresponding State class
3. Instead of calling \`$this->gamestate->nextState("transition")\`, **return the transition string**:
   \`\`\`php
   // Old
   function stNextPlayer() {
       $this->activeNextPlayer();
       $this->gamestate->nextState("playerTurn");
   }

   // New (inside NextPlayer state class)
   public function onEnteringState(): string
   {
       $this->game->activeNextPlayer();
       return 'playerTurn'; // or return PlayerTurn::class;
   }
   \`\`\`

### Step 4 — Migrate player actions

For each action listed under \`"possibleactions"\` in a state:

1. Find the corresponding method in \`Game.php\`
2. Copy it into the State class, rename to use the \`act\` prefix (e.g. \`playCard\` → \`actPlayCard\`)
3. Add the \`#[PossibleAction]\` attribute
4. Add \`int $activePlayerId\` as the first parameter (injected automatically)
5. Remove \`self::checkAction()\` — not needed
6. Replace \`$this->gamestate->nextState("x")\` with \`return 'x';\`

\`\`\`php
// Old (in Game.php)
function actPlayCard($card_id) {
    self::checkAction("actPlayCard");
    $player_id = self::getActivePlayerId();
    // ... logic ...
    $this->gamestate->nextState("next");
}

// New (inside PlayerTurn state class)
#[PossibleAction]
public function actPlayCard(int $cardId, int $activePlayerId): string
{
    // ... logic using $this->game ...
    return 'next';
}
\`\`\`

> **Note**: Parameters from JS are passed as method arguments. The framework handles type coercion from the request.

### Step 5 — Migrate state args functions

For each state that had \`"args" => "argFunctionName"\`:

1. Find \`argFunctionName()\` in your Game.php
2. Move the logic into \`getArgs(int $activePlayerId): array\` of the State class
3. Delete the old \`argFunctionName()\` from Game.php

### Step 6 — Update \`setupNewGame\`

Add a return statement pointing to the first post-setup state:

\`\`\`php
// Old: no return, uses initGameStateLabels + gamestate setup
protected function setupNewGame($players, $options = []) {
    // setup code...
    $this->gamestate->changeState(10);
}

// New: return the initial state class
protected function setupNewGame(array $players, array $options = []): mixed
{
    // setup code...
    return PlayerTurn::class;
}
\`\`\`

### Step 7 — Update the JavaScript frontend

Replace old action calls:
\`\`\`javascript
// Old
this.ajaxcall('/mygame/mygame/playCard.html', { card_id: cardId, lock: true }, this, () => {});

// New
bgaPerformAction('playCard', { cardId });
\`\`\`

Replace old notification subscriptions:
\`\`\`javascript
// Old (in setupNotifications)
this.notifqueue.subscribe("cardPlayed", this, "notif_cardPlayed");
// + separate notif_cardPlayed(notif) { ... } method

// New
this.bgaSetupPromiseNotifications({
    cardPlayed: async (notif) => {
        const { player_id, card_id } = notif.args;
        // update UI
    },
});
\`\`\`

### Step 8 — Clean up

Once all states are migrated:
- Delete \`states.inc.php\` (or leave it temporarily if you have a mixed project)
- Remove old \`st*()\`, \`arg*()\`, and action methods from \`Game.php\`
- Remove \`self::initGameStateLabels([])\` if no longer needed

---

## Useful tools

| Tool | Purpose |
|---|---|
| \`bga_migration_status\` | Scan a project for old/new patterns |
| \`bga_convert_states_inc\` | Auto-generate State class stubs from states.inc.php |
| \`bga_generate_state_class\` | Generate a single new State class |
| \`bga_generate_state_action\` | Generate a single #[PossibleAction] method stub |
| \`bga_generate_notification\` | Generate PHP + JS notification stubs |
| \`bga_get_doc_page\` (with alias \`state_classes\`) | Full BGA State classes documentation |
`;
    return { content: [{ type: "text", text: guide }] };
}
