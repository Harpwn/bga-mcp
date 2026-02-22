import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Capitalise first letter
function ucfirst(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export const scaffoldTools: Tool[] = [
  {
    name: "bga_generate_state_class",
    description:
      "Generate a PHP State class file for modules/php/States/. This is the modern BGA approach (replaces states.inc.php array entries).",
    inputSchema: {
      type: "object",
      properties: {
        className: {
          type: "string",
          description: "PascalCase class name matching the file name (e.g. 'PlayerTurn'). Will become modules/php/States/PlayerTurn.php",
        },
        gameName: {
          type: "string",
          description: "PascalCase game name used for the PHP namespace (e.g. 'MyGame')",
        },
        id: {
          type: "number",
          description: "Unique numeric state ID. Must not be 1 (reserved for gameSetup) or 99 (reserved for gameEnd).",
        },
        type: {
          type: "string",
          enum: ["ACTIVE_PLAYER", "MULTIPLE_ACTIVE_PLAYER", "PRIVATE", "GAME"],
          description: "State type. ACTIVE_PLAYER = one player acts; MULTIPLE_ACTIVE_PLAYER = several players act; GAME = automatic transition; PRIVATE = parallel private state.",
        },
        description: {
          type: "string",
          description: "Text shown to all non-active players (use ${actplayer} for the active player's name)",
        },
        descriptionMyTurn: {
          type: "string",
          description: "Text shown to the active player (use ${you} for 'You')",
        },
        transitions: {
          type: "object",
          description: "Map of transition name -> target state ID (e.g. { 'nextPlayer': 10, 'endGame': 99 })",
          additionalProperties: { type: "number" },
        },
        actions: {
          type: "array",
          items: { type: "string" },
          description: "Player action method names WITHOUT the 'act' prefix (e.g. ['playCard', 'pass']). Each becomes an #[PossibleAction] method stub.",
        },
        updateGameProgression: {
          type: "boolean",
          description: "Set to true to call getGameProgression() when entering this state (default: false)",
        },
      },
      required: ["className", "gameName", "id", "type"],
    },
  },
  {
    name: "bga_generate_state_action",
    description:
      "Generate an #[PossibleAction] method stub to add inside a BGA State class.",
    inputSchema: {
      type: "object",
      properties: {
        actionName: {
          type: "string",
          description: "Action name WITHOUT the 'act' prefix (e.g. 'playCard' â†’ generates actPlayCard)",
        },
        parameters: {
          type: "array",
          items: { type: "string" },
          description: "Typed PHP parameters (e.g. ['int $cardId', 'int $position']). activePlayerId is injected automatically by the framework.",
        },
        description: {
          type: "string",
          description: "Brief description for the docblock",
        },
        nextState: {
          type: "string",
          description: "Default transition to return (e.g. 'nextPlayer'). Can also be a class name like 'NextPlayer::class'. Defaults to a TODO comment.",
        },
      },
      required: ["actionName"],
    },
  },
  {
    name: "bga_generate_notification",
    description:
      "Generate PHP (backend) and JS (frontend) stubs for a BGA notification.",
    inputSchema: {
      type: "object",
      properties: {
        notifName: {
          type: "string",
          description: "Notification name in camelCase (e.g. 'cardPlayed')",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Data keys sent with the notification (e.g. ['player_id', 'card_id'])",
        },
      },
      required: ["notifName"],
    },
  },
  {
    name: "bga_scaffold_game",
    description:
      "Generate the skeleton file structure and boilerplate content for a new BGA game project using the modern State classes approach.",
    inputSchema: {
      type: "object",
      properties: {
        gameName: {
          type: "string",
          description: "Game name in lowercase (e.g. 'mygame'). Used for file names and class namespacing.",
        },
        playerCount: {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          description: "Min/max player counts",
        },
      },
      required: ["gameName"],
    },
  },
];

export async function handleScaffoldTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bga_generate_state_class") {
    return generateStateClass(args);
  }
  if (name === "bga_generate_state_action") {
    return generateStateAction(args);
  }
  if (name === "bga_generate_notification") {
    return generateNotification(args);
  }
  if (name === "bga_scaffold_game") {
    return scaffoldGame(args);
  }
  return { content: [{ type: "text", text: `Unknown scaffold tool: ${name}` }], isError: true };
}

// ---------------------------------------------------------------------------

function generateStateClass(args: Record<string, unknown>) {
  const className = args.className as string;
  const gameName = args.gameName as string;
  const id = args.id as number;
  const rawType = (args.type as string) ?? "ACTIVE_PLAYER";
  const stateType = `StateType::${rawType}`;
  const description = (args.description as string) ?? `\${actplayer} must do something`;
  const descriptionMyTurn = (args.descriptionMyTurn as string) ?? `\${you} must do something`;
  const transitions = (args.transitions as Record<string, number>) ?? {};
  const actions = (args.actions as string[]) ?? [];
  const updateGameProgression = (args.updateGameProgression as boolean) ?? false;
  const isPlayerState = rawType === "ACTIVE_PLAYER" || rawType === "MULTIPLE_ACTIVE_PLAYER";

  const transitionsPhp = Object.keys(transitions).length > 0
    ? `            transitions: [\n${Object.entries(transitions).map(([k, v]) => `                '${k}' => ${v},`).join("\n")}\n            ],`
    : `            transitions: [],`;

  const updateProgLine = updateGameProgression
    ? `\n            updateGameProgression: true,` : "";

  const descLines = isPlayerState
    ? `            description: clienttranslate('${description}'),\n            descriptionMyTurn: clienttranslate('${descriptionMyTurn}'),`
    : `            description: '',`;

  const actionStubs = actions.map((a) => {
    const method = `act${ucfirst(a)}`;
    return `\n    #[PossibleAction]\n    public function ${method}(int $activePlayerId): string\n    {\n        // TODO: implement ${method}\n        return 'TODO'; // return transition name or NextState::class\n    }`;
  }).join("\n");

  const zombieMethod = isPlayerState
    ? `\n\n    public function zombie(int $playerId): string\n    {\n        // TODO: handle zombie (disconnected player)\n        return ''; // return transition name or state class\n    }` : "";

  const php = `<?php
declare(strict_types=1);

namespace Bga\\Games\\${gameName}\\States;

use Bga\\GameFramework\\StateType;
use Bga\\GameFramework\\States\\GameState;
use Bga\\GameFramework\\States\\PossibleAction;
use Bga\\Games\\${gameName}\\Game;

class ${className} extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: ${id},
            type: ${stateType},
${descLines}
${transitionsPhp}${updateProgLine}
        );
    }

    public function getArgs(int $activePlayerId): array
    {
        return [
            // TODO: return data needed by the client for this state
        ];
    }

    public function onEnteringState(int $activePlayerId): void
    {
        // TODO: called when entering this state
    }
${actionStubs}${zombieMethod}
}
`;

  return {
    content: [
      {
        type: "text",
        text: `## State class: \`${className}\`\n\nSave as \`modules/php/States/${className}.php\`\n\n\`\`\`php\n${php}\`\`\``,
      },
    ],
  };
}

function generateStateAction(args: Record<string, unknown>) {
  const actionName = args.actionName as string;
  const method = `act${ucfirst(actionName)}`;
  const parameters = (args.parameters as string[]) ?? [];
  const description = (args.description as string) ?? "";
  const nextState = args.nextState as string | undefined;

  // Always inject activePlayerId as the framework auto-fills it
  const allParams = ["int $activePlayerId", ...parameters].join(", ");

  const returnLine = nextState
    ? `        return ${nextState.includes("::class") ? nextState : `'${nextState}'`};`
    : `        // TODO: return a transition name (e.g. 'nextPlayer') or a state class (e.g. NextPlayer::class)`;

  const php = `    /**
     * ${method}${description ? ": " + description : ""}
     * Called via bgaPerformAction('${actionName}', { ... }) from the client.
     */
    #[PossibleAction]
    public function ${method}(${allParams}): string
    {
        $game = $this->game;

        // TODO: validate and implement ${method}

        // Example notification:
        // $game->notify->all('${actionName}', clienttranslate('\${player_name} performs action'), [
        //     'player_id'   => $activePlayerId,
        //     'player_name' => $game->getActivePlayerName(),
        // ]);

${returnLine}
    }`;

  return {
    content: [
      {
        type: "text",
        text: `## Action method: \`${method}\`\n\nAdd inside your State class:\n\n\`\`\`php\n${php}\n\`\`\`\n\n**JS call** (in Game.js):\n\`\`\`javascript\nbgaPerformAction('${actionName}', { /* args */ });\n\`\`\``,
      },
    ],
  };
}

function generateNotification(args: Record<string, unknown>) {
  const notifName = args.notifName as string;
  const notifArgs = (args.args as string[]) ?? [];

  const phpArgLines = notifArgs.length > 0
    ? notifArgs.map((a) => `        '${a}' => $${a.replace(/_([a-z])/g, (_, c) => c.toUpperCase())},`).join("\n")
    : "        // add data here";

  const phpSnippet = `// Inside your #[PossibleAction] method (or onEnteringState for GAME states):
$this->game->notify->all(
    '${notifName}',
    clienttranslate(''),   // player-visible log message, or '' to hide
    [
${phpArgLines}
    ]
);`;

  const jsDestructure = notifArgs.length > 0
    ? `const { ${notifArgs.join(", ")} } = notif.args;`
    : "// const { } = notif.args;";

  const jsSnippet = `// In Game.js, inside setupNotifications():
this.bgaSetupPromiseNotifications({
    ${notifName}: async (notif) => {
        ${jsDestructure}
        // TODO: update the UI
    },
});`;

  return {
    content: [
      {
        type: "text",
        text: `## Notification: \`${notifName}\`\n\n### PHP (inside a State class action)\n\`\`\`php\n${phpSnippet}\n\`\`\`\n\n### JavaScript (Game.js)\n\`\`\`javascript\n${jsSnippet}\n\`\`\``,
      },
    ],
  };
}

function scaffoldGame(args: Record<string, unknown>) {
  const gameName = (args.gameName as string).toLowerCase();
  const gameNamePascal = ucfirst(gameName);
  const minPlayers = (args.playerCount as { min?: number })?.min ?? 2;
  const maxPlayers = (args.playerCount as { max?: number })?.max ?? 4;

  const files = [
    {
      path: `Game.php`,
      description: "Main game logic class",
      lang: "php",
      snippet: `<?php
declare(strict_types=1);

namespace Bga\\Games\\${gameNamePascal};

use Bga\\GameFramework\\Actions\\CheckAction;
use Bga\\Games\\${gameNamePascal}\\States\\PlayerTurn;

class Game extends \\Table
{
    public function __construct()
    {
        parent::__construct();
    }

    protected function getGameName(): string
    {
        return "${gameName}";
    }

    protected function setupNewGame(array $players, array $options = []): mixed
    {
        // TODO: create initial game state (deal cards, set scores, etc.)

        return PlayerTurn::class; // first state after gameSetup
    }

    protected function getAllDatas(): array
    {
        return [
            // TODO: return all data needed by the client on (re)load
        ];
    }

    protected function getGameProgression(): int
    {
        return 0; // TODO: return 0â€“100
    }
}
`,
    },
    {
      path: `modules/php/States/PlayerTurn.php`,
      description: "Example ACTIVE_PLAYER state",
      lang: "php",
      snippet: `<?php
declare(strict_types=1);

namespace Bga\\Games\\${gameNamePascal}\\States;

use Bga\\GameFramework\\StateType;
use Bga\\GameFramework\\States\\GameState;
use Bga\\GameFramework\\States\\PossibleAction;
use Bga\\Games\\${gameNamePascal}\\Game;
use Bga\\Games\\${gameNamePascal}\\States\\NextPlayer;

class PlayerTurn extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 10,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('\${actplayer} must play a card or pass'),
            descriptionMyTurn: clienttranslate('\${you} must play a card or pass'),
            transitions: [
                'next' => 20,
                'endGame' => 99,
            ],
            updateGameProgression: true,
        );
    }

    public function getArgs(int $activePlayerId): array
    {
        return [
            // TODO: return data for the client (e.g. playable cards)
        ];
    }

    public function onEnteringState(int $activePlayerId): void
    {
        // TODO: called when entering this state
    }

    #[PossibleAction]
    public function actPlayCard(int $cardId, int $activePlayerId): string
    {
        $game = $this->game;

        // TODO: validate and process the card play

        $game->notify->all(
            'cardPlayed',
            clienttranslate('\${player_name} plays a card'),
            [
                'player_id'   => $activePlayerId,
                'player_name' => $game->getActivePlayerName(),
                'card_id'     => $cardId,
            ]
        );

        return NextPlayer::class;
    }

    #[PossibleAction]
    public function actPass(int $activePlayerId): string
    {
        return 'next';
    }

    public function zombie(int $playerId): string
    {
        return 'next';
    }
}
`,
    },
    {
      path: `modules/php/States/NextPlayer.php`,
      description: "Example GAME state (automatic transition, no active player)",
      lang: "php",
      snippet: `<?php
declare(strict_types=1);

namespace Bga\\Games\\${gameNamePascal}\\States;

use Bga\\GameFramework\\StateType;
use Bga\\GameFramework\\States\\GameState;
use Bga\\Games\\${gameNamePascal}\\Game;

class NextPlayer extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 20,
            type: StateType::GAME,
            transitions: [
                'playerTurn' => 10,
                'endGame'    => 99,
            ],
        );
    }

    public function onEnteringState(): string
    {
        $game = $this->game;

        // Check win condition
        // if ($game->checkEndGame()) {
        //     return 'endGame';
        // }

        $game->activeNextPlayer();
        return 'playerTurn';
    }
}
`,
    },
    {
      path: `material.inc.php`,
      description: "Static game data (card types, token definitions, etc.)",
      lang: "php",
      snippet: `<?php
$this->card_types = [
    // 1 => [ 'name' => clienttranslate('Example Card'), 'value' => 1 ],
];
?>`,
    },
    {
      path: `Game.js`,
      description: "Frontend JavaScript (client-side game logic)",
      lang: "javascript",
      snippet: `define(["dojo", "dojo/_base/declare", "ebg/core/gamegui"],
    function (dojo, declare) {
        return declare("bgagame.${gameName}", ebg.core.gamegui, {

            setup(gamedatas) {
                console.log("${gameName} setup", gamedatas);
                // TODO: build the UI from gamedatas
                this.setupNotifications();
            },

            onEnteringState(stateName, args) {
                console.log("Entering state:", stateName, args);
            },

            onLeavingState(stateName) {},

            onUpdateActionButtons(stateName, args) {
                if (stateName === "PlayerTurn") {
                    this.addActionButton("btn_playCard", _("Play card"), () => this.onPlayCard());
                    this.addActionButton("btn_pass", _("Pass"), () => this.onPass());
                }
            },

            onPlayCard() {
                // bgaPerformAction('playCard', { cardId: selectedCardId });
            },

            onPass() {
                bgaPerformAction('pass', {});
            },

            setupNotifications() {
                this.bgaSetupPromiseNotifications({
                    cardPlayed: async (notif) => {
                        const { player_id, card_id } = notif.args;
                        // TODO: animate the card play
                    },
                });
            },
        });
    }
);`,
    },
    {
      path: `gameinfos.inc.php`,
      description: "Game metadata",
      lang: "php",
      snippet: `<?php
$gameinfos = [
    "game_name"            => "${gameName}",
    "designer"             => "Your Name",
    "artist"               => "Your Name",
    "year"                 => 2025,
    "players_minthreshold" => ${minPlayers},
    "players_maxthreshold" => ${maxPlayers},
    // ... other fields
];
?>`,
    },
  ];

  const output = files
    .map((f) => `### \`${f.path}\`\n*${f.description}*\n\`\`\`${f.lang}\n${f.snippet}\`\`\``)
    .join("\n\n---\n\n");

  return {
    content: [
      {
        type: "text",
        text: `# BGA Game Scaffold: \`${gameName}\`\n\nUses the modern **State classes** approach (PHP namespaced classes in \`modules/php/States/\`).\n\n${output}`,
      },
    ],
  };
}
