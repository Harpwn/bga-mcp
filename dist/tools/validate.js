import fs from "fs";
import path from "path";
import { WORKSPACE_PATH } from "../config.js";
// ---------------------------------------------------------------------------
// Path resolution (mirrors project.ts / migrate.ts)
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
// Tool definition
// ---------------------------------------------------------------------------
const projectPathProp = {
    type: "string",
    description: "Absolute path to the BGA game project root (overrides gameName).",
};
const gameNameProp = {
    type: "string",
    description: WORKSPACE_PATH
        ? "Name of the game subfolder inside the workspace. Auto-selected when only one game is present."
        : "Name of the game subfolder within the games workspace directory.",
};
export const validateTools = [
    {
        name: "bga_validate_project",
        description: "Lint a local BGA game project for common bugs and inconsistencies: broken transition targets, missing zombie() methods, JS↔PHP action name mismatches, duplicate state IDs, unreachable states, mismatched filenames vs class names, and more.",
        inputSchema: {
            type: "object",
            properties: {
                projectPath: projectPathProp,
                gameName: gameNameProp,
            },
            required: [],
        },
    },
];
export async function handleValidateTool(name, args) {
    if (name === "bga_validate_project")
        return validateProject(args);
    return { content: [{ type: "text", text: `Unknown validate tool: ${name}` }], isError: true };
}
// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------
/** Parse all entries from a states.inc.php content string. */
function parseStatesInc(content, relPath) {
    const states = [];
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
        const name = get("name");
        if (!name)
            continue;
        states.push({
            id,
            name,
            type: get("type"),
            transitions,
            possibleactions,
            hasZombie: false,
            source: "states.inc.php",
            file: relPath,
        });
    }
    return states;
}
/** Parse a single State class PHP file. */
function parseStateClass(content, relPath) {
    // Extract id and type from constructor parent::__construct call
    const idMatch = content.match(/id\s*:\s*(\d+)/);
    const typeMatch = content.match(/type\s*:\s*(StateType::\w+)/);
    const nameMatch = content.match(/class\s+(\w+)\s+extends\s+GameState/);
    if (!idMatch || !typeMatch || !nameMatch)
        return null;
    const id = parseInt(idMatch[1], 10);
    const type = typeMatch[1]; // e.g. "StateType::ACTIVE_PLAYER"
    const className = nameMatch[1];
    // Transitions: transitions: [ 'key' => id, ... ]
    const transBlock = content.match(/transitions\s*:\s*\[([\s\S]*?)\]/);
    const transitions = {};
    if (transBlock) {
        for (const t of transBlock[1].matchAll(/'([^']+)'\s*=>\s*(\d+)/g)) {
            transitions[t[1]] = parseInt(t[2], 10);
        }
        // Also match double-quoted
        for (const t of transBlock[1].matchAll(/"([^"]+)"\s*=>\s*(\d+)/g)) {
            transitions[t[1]] = parseInt(t[2], 10);
        }
    }
    // Actions: methods with #[PossibleAction] — capture the method name after the attribute
    const possibleactions = [];
    const paRegex = /#\[PossibleAction\]\s*(?:\/\/[^\n]*)?\s*public\s+function\s+act(\w+)\s*\(/g;
    for (const a of content.matchAll(paRegex)) {
        possibleactions.push(a[1]); // store without "act" prefix for normalisation
    }
    const hasZombie = /public\s+function\s+zombie\s*\(/.test(content);
    return {
        id,
        name: className,
        type,
        transitions,
        possibleactions,
        hasZombie,
        source: "StateClass",
        file: relPath,
        className,
    };
}
// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function isPlayerStateType(type) {
    const t = type.toLowerCase();
    return (t === "activeplayer" ||
        t === "multipleactiveplayer" ||
        t.includes("active_player") ||
        t.includes("multiple_active"));
}
/**
 * Normalise an action name: strip leading "act" (lowercase) prefix if present.
 * "actPlayCard" → "playCard", "playCard" → "playCard"
 */
function normaliseAction(name) {
    return name.startsWith("act") ? name.slice(3, 4).toLowerCase() + name.slice(4) : name;
}
function runChecks(projectPath, gameName, states, diags, rel) {
    const stateIds = new Set(states.map((s) => s.id));
    const RESERVED_INITIAL = 1;
    const RESERVED_END = 99;
    stateIds.add(RESERVED_INITIAL);
    stateIds.add(RESERVED_END);
    // ── 1. Duplicate state IDs ────────────────────────────────────────────────
    const idCounts = new Map();
    for (const s of states) {
        if (!idCounts.has(s.id))
            idCounts.set(s.id, []);
        idCounts.get(s.id).push(s);
    }
    for (const [id, group] of idCounts) {
        if (group.length > 1) {
            diags.push({
                severity: "error",
                file: group.map((g) => g.file).join(", "),
                message: `Duplicate state ID ${id} declared in: ${group.map((g) => `\`${g.file}\``).join(" and ")}`,
                hint: "Each state must have a unique numeric ID.",
            });
        }
    }
    // ── 2. Broken transition targets ─────────────────────────────────────────
    for (const s of states) {
        for (const [label, targetId] of Object.entries(s.transitions)) {
            if (!stateIds.has(targetId)) {
                diags.push({
                    severity: "error",
                    file: s.file,
                    message: `State \`${s.name}\` (id=${s.id}): transition \`'${label}'\` points to id=${targetId} which does not exist.`,
                    hint: "Check the transitions map — the target state ID is not declared anywhere in the project.",
                });
            }
        }
    }
    // ── 3. Unreachable states (never a transition target, not initial/end) ────
    const referencedIds = new Set([RESERVED_INITIAL, RESERVED_END]);
    for (const s of states) {
        for (const targetId of Object.values(s.transitions)) {
            referencedIds.add(targetId);
        }
    }
    for (const s of states) {
        if (!referencedIds.has(s.id) && s.id !== RESERVED_INITIAL && s.id !== RESERVED_END) {
            diags.push({
                severity: "warning",
                file: s.file,
                message: `State \`${s.name}\` (id=${s.id}) is never referenced as a transition target — it may be unreachable.`,
                hint: "Either another state should transition to this one, or it can be deleted.",
            });
        }
    }
    // ── 4. Missing zombie() on player states ─────────────────────────────────
    for (const s of states) {
        if (isPlayerStateType(s.type) && !s.hasZombie && s.source === "StateClass") {
            diags.push({
                severity: "warning",
                file: s.file,
                message: `State class \`${s.name}\` (id=${s.id}) is a player state but has no \`zombie()\` method.`,
                hint: "Add a `public function zombie(int $playerId): string` method to handle disconnected players.",
            });
        }
    }
    // ── 5. State class filename vs class name mismatch ────────────────────────
    for (const s of states) {
        if (s.source !== "StateClass" || !s.className)
            continue;
        const filename = path.basename(s.file, ".php");
        if (filename !== s.className) {
            diags.push({
                severity: "error",
                file: s.file,
                message: `File is named \`${filename}.php\` but declares class \`${s.className}\`.`,
                hint: "BGA autoloads State classes by filename. Rename the file to match the class name (or vice versa).",
            });
        }
    }
    // ── 6. State ID 1 / 99 reserved names ────────────────────────────────────
    for (const s of states) {
        if (s.id === RESERVED_INITIAL && s.name !== "gameSetup" && s.source === "states.inc.php") {
            diags.push({
                severity: "warning",
                file: s.file,
                message: `State id=1 is named \`${s.name}\` — BGA reserves id=1 for \`gameSetup\`.`,
            });
        }
        if (s.id === RESERVED_END && s.name !== "gameEnd" && s.name !== "GameEnd" && s.source === "states.inc.php") {
            diags.push({
                severity: "warning",
                file: s.file,
                message: `State id=99 is named \`${s.name}\` — BGA reserves id=99 for \`gameEnd\`.`,
            });
        }
    }
    // ── 7. JS ↔ PHP action name sync ─────────────────────────────────────────
    const files = fs.readdirSync(projectPath);
    const jsFile = files.find((f) => f.endsWith(".js") && !f.includes(".min.") && f !== "Gruntfile.js");
    if (jsFile) {
        const jsContent = fs.readFileSync(path.join(projectPath, jsFile), "utf-8");
        // Collect all bgaPerformAction calls
        const bgaActionNames = new Set();
        for (const m of jsContent.matchAll(/bgaPerformAction\s*\(\s*['"](\w+)['"]/g)) {
            bgaActionNames.add(m[1]);
        }
        // Also collect old ajaxcall targets (action.html pattern)
        for (const m of jsContent.matchAll(/\/[\w]+\/[\w]+\/(\w+)\.html/g)) {
            bgaActionNames.add(m[1]);
        }
        // Collect all declared PHP actions (normalised, without "act" prefix)
        const phpActions = new Set();
        for (const s of states) {
            for (const a of s.possibleactions) {
                phpActions.add(normaliseAction(a));
            }
        }
        // Also scan Game.php for checkAction patterns (legacy)
        const gamePhp = ["Game.php", ...files.filter((f) => f.endsWith(".game.php"))].find((f) => fs.existsSync(path.join(projectPath, f)));
        if (gamePhp) {
            const phpContent = fs.readFileSync(path.join(projectPath, gamePhp), "utf-8");
            for (const m of phpContent.matchAll(/function\s+(act\w+)\s*\(/g)) {
                phpActions.add(normaliseAction(m[1]));
            }
        }
        for (const jsAction of bgaActionNames) {
            const normalised = normaliseAction(jsAction);
            if (!phpActions.has(normalised)) {
                diags.push({
                    severity: "error",
                    file: jsFile,
                    message: `JS calls \`bgaPerformAction('${jsAction}', ...)\` but no matching \`act${jsAction.charAt(0).toUpperCase() + jsAction.slice(1)}\` PHP method was found.`,
                    hint: "Add a `#[PossibleAction]` method in the appropriate State class, or check for a typo.",
                });
            }
        }
        for (const phpAction of phpActions) {
            const jsName = phpAction; // normalised (no "act" prefix)
            if (bgaActionNames.size > 0 && !bgaActionNames.has(jsName) && !bgaActionNames.has(`act${jsName.charAt(0).toUpperCase() + jsName.slice(1)}`)) {
                diags.push({
                    severity: "info",
                    file: jsFile,
                    message: `PHP action \`act${jsName.charAt(0).toUpperCase() + jsName.slice(1)}\` has no corresponding \`bgaPerformAction('${jsName}', ...)\` call in \`${jsFile}\`.`,
                    hint: "The action may be invoked another way, or the JS call is missing.",
                });
            }
        }
    }
    // ── 8. PHP notification → JS handler sync ────────────────────────────────
    if (jsFile) {
        const jsContent = fs.readFileSync(path.join(projectPath, jsFile), "utf-8");
        // Collect notification names from JS bgaSetupPromiseNotifications
        const jsNotifs = new Set();
        const bgaNotifBlock = jsContent.match(/bgaSetupPromiseNotifications\s*\(\s*\{([\s\S]*?)\}\s*\)/);
        if (bgaNotifBlock) {
            for (const m of bgaNotifBlock[1].matchAll(/['"]?(\w+)['"]?\s*:/g)) {
                jsNotifs.add(m[1]);
            }
        }
        // Also old-style notifqueue.subscribe
        for (const m of jsContent.matchAll(/notifqueue\.subscribe\s*\(\s*['"](\w+)['"]/g)) {
            jsNotifs.add(m[1]);
        }
        // Collect notification names from PHP notify->all / notifyAllPlayers calls
        const phpNotifs = new Set();
        const phpFilesToScan = [
            ...files.filter((f) => f.endsWith(".php") || f.endsWith(".game.php")),
        ];
        // Also scan State class files
        const statesDir = path.join(projectPath, "modules", "php", "States");
        if (fs.existsSync(statesDir)) {
            for (const f of fs.readdirSync(statesDir).filter((f) => f.endsWith(".php"))) {
                phpFilesToScan.push(path.join("modules", "php", "States", f));
            }
        }
        for (const phpFile of phpFilesToScan) {
            const phpPath = path.join(projectPath, phpFile);
            if (!fs.existsSync(phpPath))
                continue;
            const phpContent = fs.readFileSync(phpPath, "utf-8");
            for (const m of phpContent.matchAll(/notify\s*->\s*(?:all|player|allWithPrivateArguments|players)\s*\(\s*['"](\w+)['"]/g)) {
                phpNotifs.add(m[1]);
            }
            // Legacy: notifyAllPlayers("name", ...)
            for (const m of phpContent.matchAll(/notifyAllPlayers\s*\(\s*['"](\w+)['"]/g)) {
                phpNotifs.add(m[1]);
            }
            for (const m of phpContent.matchAll(/notifyPlayer\s*\(\s*[^,]+,\s*['"](\w+)['"]/g)) {
                phpNotifs.add(m[1]);
            }
        }
        // PHP sends a notif that JS doesn't handle
        for (const notif of phpNotifs) {
            if (notif === "message" || notif === "tableWindow")
                continue; // BGA built-ins
            if (!jsNotifs.has(notif)) {
                diags.push({
                    severity: "warning",
                    file: jsFile,
                    message: `PHP sends notification \`'${notif}'\` but no JS handler was found in \`${jsFile}\`.`,
                    hint: "Add a handler in `bgaSetupPromiseNotifications` (or old-style `notifqueue.subscribe`).",
                });
            }
        }
        // JS handles a notif that PHP never sends
        for (const notif of jsNotifs) {
            if (!phpNotifs.has(notif)) {
                diags.push({
                    severity: "info",
                    file: jsFile,
                    message: `JS handles notification \`'${notif}'\` but no PHP \`notify->all\` / \`notifyAllPlayers\` call was found for it.`,
                    hint: "The PHP side may be missing a notification send, or the handler is no longer needed.",
                });
            }
        }
    }
    // ── 9. Stub getGameProgression (always returns 0) ────────────────────────
    const gamePhpFiles = ["Game.php", ...files.filter((f) => f.endsWith(".game.php"))];
    for (const phpFile of gamePhpFiles) {
        const phpPath = path.join(projectPath, phpFile);
        if (!fs.existsSync(phpPath))
            continue;
        const phpContent = fs.readFileSync(phpPath, "utf-8");
        const progMatch = phpContent.match(/function\s+getGameProgression\s*\(\s*\)[\s\S]{0,200}?return\s+(\d+)\s*;/);
        if (progMatch && progMatch[1] === "0") {
            diags.push({
                severity: "info",
                file: phpFile,
                message: "`getGameProgression()` always returns `0` — the progress bar will never advance.",
                hint: "Implement a meaningful progression calculation (0–100) based on game state.",
            });
        }
        break;
    }
    // ── 10. State class: missing PossibleAction import ───────────────────────
    const statesDir = path.join(projectPath, "modules", "php", "States");
    if (fs.existsSync(statesDir)) {
        for (const f of fs.readdirSync(statesDir).filter((f) => f.endsWith(".php"))) {
            const content = fs.readFileSync(path.join(statesDir, f), "utf-8");
            const hasAttr = /#\[PossibleAction\]/.test(content);
            const hasUse = /use\s+Bga\\GameFramework\\States\\PossibleAction/.test(content);
            if (hasAttr && !hasUse) {
                diags.push({
                    severity: "error",
                    file: rel(path.join(statesDir, f)),
                    message: `\`${f}\` uses \`#[PossibleAction]\` but is missing: \`use Bga\\GameFramework\\States\\PossibleAction;\``,
                    hint: "Add the `use` statement at the top of the class file.",
                });
            }
        }
    }
    // ── 11. actions declared in state but no matching method in class ─────────
    // (Only for State classes — we can verify possibleactions vs actual methods)
    if (fs.existsSync(statesDir)) {
        for (const s of states) {
            if (s.source !== "StateClass")
                continue;
            const content = fs.readFileSync(path.join(projectPath, s.file), "utf-8");
            for (const action of s.possibleactions) {
                // possibleactions stored without "act" prefix; method should be actXxx
                const methodName = `act${action.charAt(0).toUpperCase() + action.slice(1)}`;
                const methodRegex = new RegExp(`function\\s+${methodName}\\s*\\(`);
                if (!methodRegex.test(content)) {
                    diags.push({
                        severity: "error",
                        file: s.file,
                        message: `State \`${s.name}\` declares \`#[PossibleAction]\` for \`${methodName}\` but no such method exists in the file.`,
                        hint: `Add a \`public function ${methodName}(int $activePlayerId): string\` method.`,
                    });
                }
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------
function validateProject(args) {
    const { resolved: projectPath, gameName } = resolveProjectPath(args);
    if (!projectPath) {
        const games = WORKSPACE_PATH ? discoverGames(WORKSPACE_PATH) : [];
        return noProjectPathError(games.length > 1);
    }
    const rel = (p) => path.relative(projectPath, p).replace(/\\/g, "/");
    const states = [];
    const diags = [];
    // ── Collect state definitions ─────────────────────────────────────────────
    // 1. states.inc.php
    const statesIncPath = path.join(projectPath, "states.inc.php");
    if (fs.existsSync(statesIncPath)) {
        try {
            const content = fs.readFileSync(statesIncPath, "utf-8");
            states.push(...parseStatesInc(content, "states.inc.php"));
        }
        catch (err) {
            diags.push({ severity: "error", file: "states.inc.php", message: `Could not read states.inc.php: ${err}` });
        }
    }
    // 2. modules/php/States/*.php
    const statesDir = path.join(projectPath, "modules", "php", "States");
    if (fs.existsSync(statesDir)) {
        for (const f of fs.readdirSync(statesDir).filter((f) => f.endsWith(".php"))) {
            const filePath = path.join(statesDir, f);
            const relPath = rel(filePath);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const parsed = parseStateClass(content, relPath);
                if (parsed)
                    states.push(parsed);
                else {
                    diags.push({
                        severity: "info",
                        file: relPath,
                        message: `Could not parse \`${f}\` as a State class (no \`class X extends GameState\` with \`id:\` and \`type:\` found).`,
                    });
                }
            }
            catch (err) {
                diags.push({ severity: "error", file: relPath, message: `Could not read file: ${err}` });
            }
        }
    }
    if (states.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `# Validation: \`${gameName}\`\n\nNo state definitions found — checked \`states.inc.php\` and \`modules/php/States/\`.\nIs this a valid BGA project directory?`,
                },
            ],
            isError: true,
        };
    }
    // ── Run checks ────────────────────────────────────────────────────────────
    runChecks(projectPath, gameName, states, diags, rel);
    // ── Format output ─────────────────────────────────────────────────────────
    const errors = diags.filter((d) => d.severity === "error");
    const warnings = diags.filter((d) => d.severity === "warning");
    const infos = diags.filter((d) => d.severity === "info");
    const icon = {
        error: "🔴",
        warning: "🟡",
        info: "🔵",
    };
    function formatGroup(items, heading) {
        if (items.length === 0)
            return "";
        const lines = items.map((d) => {
            const hint = d.hint ? `\n  > 💡 ${d.hint}` : "";
            return `- ${icon[d.severity]} \`${d.file}\`  \n  ${d.message}${hint}`;
        });
        return `### ${heading} (${items.length})\n\n${lines.join("\n\n")}\n`;
    }
    const statusLine = errors.length > 0
        ? `**Status: ${errors.length} error(s)** — fix these before submitting ❌`
        : warnings.length > 0
            ? `**Status: ${warnings.length} warning(s)** — review recommended ⚠️`
            : `**Status: All checks passed** ✅`;
    const summary = [
        `# Validation Report: \`${gameName}\``,
        "",
        statusLine,
        "",
        `Scanned **${states.length}** state definition(s) across ${fs.existsSync(statesIncPath) ? "`states.inc.php`" : ""}${fs.existsSync(statesIncPath) && fs.existsSync(statesDir) ? " + " : ""}${fs.existsSync(statesDir) ? `\`modules/php/States/\`` : ""}.`,
        "",
        formatGroup(errors, "Errors"),
        formatGroup(warnings, "Warnings"),
        formatGroup(infos, "Info / Suggestions"),
    ]
        .filter((l) => l !== undefined)
        .join("\n");
    return { content: [{ type: "text", text: summary }] };
}
