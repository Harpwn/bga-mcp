import axios from "axios";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { BGA_DOC_PAGES, BGA_WIKI_API, BGA_WIKI_TIMEOUT_MS, type DocPage } from "../config.js";

export { BGA_DOC_PAGES };

const PAGE_BY_ALIAS = new Map(BGA_DOC_PAGES.map((p) => [p.alias, p]));

// ---------------------------------------------------------------------------

export const docTools: Tool[] = [
  {
    name: "bga_list_doc_pages",
    description:
      "ALWAYS call this first when the user asks any question about BGA Studio development, " +
      "game logic, PHP/JS APIs, state machines, notifications, deck management, scoring, or any " +
      "BGA-specific topic — even if you think you already know the answer. " +
      "Returns a categorised catalog of all available BGA Studio documentation pages with their aliases. " +
      "Use the aliases with bga_get_doc_page to fetch the full authoritative content before responding.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "bga_get_doc_page",
    description:
      "Fetch the full authoritative content of a BGA Studio wiki page. " +
      "ALWAYS call this (after bga_list_doc_pages) before answering any BGA implementation question " +
      "— do NOT rely on training knowledge alone for BGA-specific APIs, patterns, or file formats, " +
      "as these change and your training data may be stale or incomplete. " +
      "Provide the alias from bga_list_doc_pages (e.g. 'notifications', 'state_classes', 'deck') " +
      "or a raw wiki page name. " +
      "Key aliases to know: 'state_classes' (modern PHP states), 'main_game_logic' (Game.php), " +
      "'notifications' (notify API), 'deck' (Deck component), 'debugging' (debug_ functions), " +
      "'game_interface' (Game.js), 'bga_cards', 'bga_animations', 'bga_dice'.",
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

export async function handleDocTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bga_list_doc_pages") {
    return listDocPages();
  }
  if (name === "bga_get_doc_page") {
    const input = args.page as string;
    // Resolve alias â†’ wiki page name, or fall through to raw page name
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
      .map((p) => `  - \`${p.alias}\` â€” ${p.description}`)
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
      timeout: BGA_WIKI_TIMEOUT_MS,
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