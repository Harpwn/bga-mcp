import axios from "axios";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Curated BGA documentation page catalog
// ---------------------------------------------------------------------------

interface DocPage {
  alias: string;        // short key used as the tool argument
  wikiPage: string;     // exact MediaWiki page title
  description: string;  // one-line summary shown in the catalog
  category: string;
}

export const BGA_DOC_PAGES: DocPage[] = [
  // ── Game logic (Server side) ──────────────────────────────────────────────
  { alias: "main_game_logic",      wikiPage: "Main_game_logic:_Game.php",                         description: "Game.php — main server-side game logic class",                                      category: "Game Logic" },
  { alias: "game_states",          wikiPage: "Your_game_state_machine:_states.inc.php",           description: "states.inc.php — state machine definition, state types and transitions",           category: "Game Logic" },
  { alias: "state_classes",        wikiPage: "State_classes:_State_directory",                    description: "States/ directory — PHP state class structure and methods",                        category: "Game Logic" },
  { alias: "player_actions",       wikiPage: "Players_actions:_yourgamename.action.php",          description: "action.php — PHP player action methods and checkAction / ajaxcall wiring",         category: "Game Logic" },
  { alias: "notifications",        wikiPage: "Notifications",                                     description: "PHP notifyAllPlayers / notifyPlayer and JS notif handlers",                        category: "Game Logic" },
  { alias: "database",             wikiPage: "Game_database_model:_dbmodel.sql",                  description: "dbmodel.sql — database schema and BGA DB helper methods",                          category: "Game Logic" },
  { alias: "material",             wikiPage: "Game_material_description:_material.inc.php",       description: "material.inc.php — defining card types, tokens, and static game data",            category: "Game Logic" },
  { alias: "stats",                wikiPage: "Game_statistics:_stats.json",                       description: "stats.json — defining player and table statistics",                               category: "Game Logic" },

  // ── Game interface (Client side) ─────────────────────────────────────────
  { alias: "game_interface",       wikiPage: "Game_interface_logic:_Game.js",                     description: "Game.js — JS interface: setup, onEnteringState, action buttons, notifications",   category: "Game Interface" },
  { alias: "game_layout",          wikiPage: "Game_layout:_view_and_template:_yourgamename.view.php_and_yourgamename_yourgamename.tpl", description: "view.php and .tpl — server-rendered layout and static HTML template", category: "Game Interface" },
  { alias: "game_css",             wikiPage: "Game_interface_stylesheet:_yourgamename.css",       description: "yourgamename.css — game interface stylesheet",                                     category: "Game Interface" },
  { alias: "game_art",             wikiPage: "Game_art:_img_directory",                           description: "img/ directory — game art assets and how to reference them",                      category: "Game Interface" },
  { alias: "mobile",               wikiPage: "Your_game_mobile_version",                          description: "Making your game work well for mobile users",                                      category: "Game Interface" },

  // ── Other file references ─────────────────────────────────────────────────
  { alias: "game_file_reference",  wikiPage: "Studio_file_reference",                             description: "Full overview of all files in a BGA game project",                                category: "File Reference" },
  { alias: "gameinfos",            wikiPage: "Game_meta-information:_gameinfos.inc.php",          description: "gameinfos.inc.php — player counts, game options, flags, metadata",               category: "File Reference" },
  { alias: "game_options",         wikiPage: "Options_and_preferences:_gameoptions.json,_gamepreferences.json", description: "gameoptions.json / gamepreferences.json — game options and user preferences", category: "File Reference" },
  { alias: "translations",         wikiPage: "Translations",                                      description: "clienttranslate(), _() and the BGA i18n workflow",                                category: "File Reference" },
  { alias: "game_replay",          wikiPage: "Game_replay",                                       description: "How BGA game replay works and what to implement",                                  category: "File Reference" },

  // ── JS Components ─────────────────────────────────────────────────────────
  { alias: "counter",              wikiPage: "Counter",                                           description: "JS Counter — animated counter for scores and resources",                          category: "JS Components" },
  { alias: "scrollmap",            wikiPage: "Scrollmap",                                         description: "JS Scrollmap — scrollable/infinite game area (e.g. Takenoko, Saboteur)",          category: "JS Components" },
  { alias: "stock",                wikiPage: "Stock",                                             description: "JS Stock — display and manage a set of game elements at a position",              category: "JS Components" },
  { alias: "zone",                 wikiPage: "Zone",                                              description: "JS Zone — manage a board area where tokens come and go",                         category: "JS Components" },
  { alias: "draggable",            wikiPage: "Draggable",                                         description: "JS Draggable — drag-and-drop actions",                                            category: "JS Components" },
  { alias: "bga_animations",       wikiPage: "BgaAnimations",                                     description: "bga-animations — JS component for smooth game animations",                       category: "JS Components" },
  { alias: "bga_cards",            wikiPage: "BgaCards",                                          description: "bga-cards — JS component for card management and display",                        category: "JS Components" },
  { alias: "bga_dice",             wikiPage: "BgaDice",                                           description: "bga-dice — JS component for dice display",                                       category: "JS Components" },

  // ── PHP Components ────────────────────────────────────────────────────────
  { alias: "deck",                 wikiPage: "Deck",                                              description: "PHP Deck — card management: deck, hand, picking, moving, shuffle",               category: "PHP Components" },
  { alias: "player_counter",       wikiPage: "PlayerCounter_and_TableCounter",                    description: "PHP PlayerCounter and TableCounter — manage numeric counters server-side",        category: "PHP Components" },

  // ── Studio User Guide ─────────────────────────────────────────────────────
  { alias: "studio_start",         wikiPage: "First_steps_with_BGA_Studio",                       description: "First steps with BGA Studio — environment setup and first run",                  category: "Studio Guide" },
  { alias: "walkthrough",          wikiPage: "Create_a_game_in_BGA_Studio:_Complete_Walkthrough", description: "Complete walkthrough: creating a game from scratch in BGA Studio",               category: "Studio Guide" },
  { alias: "tutorial_reversi",     wikiPage: "Tutorial_reversi",                                  description: "Tutorial: Reversi — recommended beginner tutorial maintained by BGA team",       category: "Studio Guide" },
  { alias: "guidelines",           wikiPage: "BGA_Studio_Guidelines",                             description: "BGA Studio coding guidelines and best practices",                                 category: "Studio Guide" },
  { alias: "tips",                 wikiPage: "I_wish_I_knew_this_when_I_started",                 description: "One-liners on the most common missed features and mistakes",                      category: "Studio Guide" },
  { alias: "debugging",            wikiPage: "Practical_debugging",                               description: "Practical tips for debugging PHP and JS in BGA Studio",                         category: "Studio Guide" },
  { alias: "troubleshooting",      wikiPage: "Troubleshooting",                                   description: "Common 'I am really stuck' situations and their solutions",                      category: "Studio Guide" },
  { alias: "lifecycle",            wikiPage: "BGA_game_Lifecycle",                                description: "BGA game lifecycle: alpha → beta → release stages",                              category: "Studio Guide" },
  { alias: "faq",                  wikiPage: "Studio_FAQ",                                        description: "BGA Studio frequently asked questions",                                          category: "Studio Guide" },
  { alias: "migration",            wikiPage: "BGA_Studio_Migration_Guide",                        description: "Migration guide for upgrading from older BGA Studio framework versions",         category: "Studio Guide" },
  { alias: "typescript",           wikiPage: "Using_Typescript_and_Scss",                         description: "How to use TypeScript and SCSS in BGA game development",                        category: "Studio Guide" },
  { alias: "cookbook",             wikiPage: "BGA_Studio_Cookbook",                               description: "Tips for using APIs, libraries and frameworks in BGA Studio",                   category: "Studio Guide" },
];

const PAGE_BY_ALIAS = new Map(BGA_DOC_PAGES.map((p) => [p.alias, p]));

// ---------------------------------------------------------------------------

export const docTools: Tool[] = [
  {
    name: "bga_list_doc_pages",
    description:
      "List all curated BGA Studio documentation pages available to fetch, grouped by category.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "bga_get_doc_page",
    description:
      "Fetch the full content of a BGA Studio wiki page. Provide either an alias from bga_list_doc_pages or a raw wiki page name.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          description:
            "Alias from the catalog (e.g. 'game_states', 'notifications') or a raw wiki page name (e.g. 'Your_game_state_machine').",
        },
      },
      required: ["page"],
    },
  },
];

const BGA_WIKI_API = "https://en.doc.boardgamearena.com/api.php";

export async function handleDocTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bga_list_doc_pages") {
    return listDocPages();
  }
  if (name === "bga_get_doc_page") {
    const input = args.page as string;
    // Resolve alias → wiki page name, or fall through to raw page name
    const entry = PAGE_BY_ALIAS.get(input);
    return getBGADocPage(entry?.wikiPage ?? input, entry);
  }
  return { content: [{ type: "text", text: `Unknown doc tool: ${name}` }], isError: true };
}

function listDocPages() {
  const byCategory = new Map<string, DocPage[]>();
  for (const p of BGA_DOC_PAGES) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p);
  }
  const sections = [...byCategory.entries()].map(([cat, pages]) => {
    const rows = pages
      .map((p) => `  - \`${p.alias}\` — ${p.description}`)
      .join("\n");
    return `### ${cat}\n${rows}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `## BGA Documentation Pages\n\nPass any alias to \`bga_get_doc_page\`.\n\n${sections.join("\n\n")}`,
      },
    ],
  };
}

async function getBGADocPage(page: string, entry?: DocPage) {
  const label = entry ? `${entry.description} (${entry.alias})` : page;
  try {
    const response = await axios.get(BGA_WIKI_API, {
      params: {
        action: "query",
        titles: page,
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        format: "json",
        origin: "*",
        formatversion: "2",
      },
      timeout: 10000,
    });

    const pages = response.data?.query?.pages ?? [];
    if (!pages.length || pages[0].missing) {
      return {
        content: [
          {
            type: "text",
            text: `Page "${page}" not found on the BGA Studio wiki.\n\nUse \`bga_list_doc_pages\` to see available pages.`,
          },
        ],
      };
    }

    const content =
      pages[0].revisions?.[0]?.slots?.main?.content ??
      pages[0].revisions?.[0]?.content ??
      "(no content)";

    if (/^\s*this (page|file) is deprecated/i.test(content)) {
      return {
        content: [
          {
            type: "text",
            text: `Page "${label}" is marked as deprecated on the BGA Studio wiki and has been skipped.\n\nUse \`bga_list_doc_pages\` to find an up-to-date alternative.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `## BGA Wiki: ${label}\n\nhttps://en.doc.boardgamearena.com/${page.replace(/ /g, "_")}\n\n${content}`,
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `Error fetching BGA wiki page "${label}": ${msg}` },
      ],
      isError: true,
    };
  }
}
