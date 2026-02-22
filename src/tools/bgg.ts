import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// BoardGameGeek XML API v2
// ---------------------------------------------------------------------------

const BGG_API = "https://boardgamegeek.com/xmlapi2";
const BGG_TIMEOUT_MS = 15_000;

/**
 * BGG returns 202 when the request is queued for processing.
 * Retry up to this many times with a short delay before giving up.
 */
const BGG_RETRY_ATTEMPTS = 4;
const BGG_RETRY_DELAY_MS = 2_000;

/**
 * BGG Bearer token — set via the BGG_API_TOKEN environment variable.
 * Register your application at https://boardgamegeek.com/applications to get one.
 */
const BGG_API_TOKEN = process.env.BGG_API_TOKEN;

/** Axios instance with required Authorization + browser-like headers. */
const bggClient = axios.create({
  headers: {
    ...(BGG_API_TOKEN ? { Authorization: `Bearer ${BGG_API_TOKEN}` } : {}),
    "User-Agent":
      "bga-mcp-server/1.0 (https://github.com/bga-mcp)",
    Accept: "application/xml, text/xml, */*",
  },
  timeout: BGG_TIMEOUT_MS,
});

/** GET with automatic 202-retry logic and helpful 401 error. */
async function bggGet(
  url: string,
  params: Record<string, unknown>
): Promise<string> {
  if (!BGG_API_TOKEN) {
    throw new Error(
      "BGG_API_TOKEN is not set. Register your application at " +
        "https://boardgamegeek.com/applications to get a Bearer token, " +
        "then set it as the BGG_API_TOKEN environment variable."
    );
  }
  for (let attempt = 0; attempt < BGG_RETRY_ATTEMPTS; attempt++) {
    const response = await bggClient.get<string>(url, {
      params,
      responseType: "text",
      validateStatus: (s) => s === 200 || s === 202 || s === 401,
    });
    if (response.status === 401) {
      throw new Error(
        "BGG API returned 401 Unauthorized. Your BGG_API_TOKEN may be invalid or expired. " +
          "Check your token at https://boardgamegeek.com/applications."
      );
    }
    if (response.status === 200) return response.data;
    // 202 = BGG is processing; wait and retry
    await new Promise((r) => setTimeout(r, BGG_RETRY_DELAY_MS));
  }
  throw new Error(
    `BGG API kept returning 202 (queued) after ${BGG_RETRY_ATTEMPTS} attempts`
  );
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) =>
    ["item", "name", "link", "rank"].includes(tagName),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const bggTools: Tool[] = [
  {
    name: "bgg_search_game",
    description:
      "Search BoardGameGeek for a board game by name. Returns a list of matching games with their BGG IDs, which can be used with bgg_get_game_info.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The game name to search for (e.g. 'Wingspan', 'Catan').",
        },
        exact: {
          type: "boolean",
          description:
            "If true, only return exact name matches. Defaults to false (fuzzy search).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "bgg_get_game_info",
    description:
      "Retrieve detailed information about a board game from BoardGameGeek: description, player count, play time, age, mechanics, categories, designers, publishers, and BGG rating. " +
      "Use bgg_search_game first to find the BGG ID if you only know the game name.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The BoardGameGeek game ID (e.g. 266192 for Wingspan).",
        },
        name: {
          type: "string",
          description:
            "Game name to auto-resolve to a BGG ID. Ignored if 'id' is provided.",
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleBggTool(
  name: string,
  args: Record<string, unknown>
) {
  if (name === "bgg_search_game") {
    const query = args.query as string;
    const exact = args.exact === true ? 1 : 0;
    return bggSearch(query, exact);
  }
  if (name === "bgg_get_game_info") {
    const id = args.id as number | undefined;
    const gameName = args.name as string | undefined;
    return bggGetGameInfo(id, gameName);
  }
  return {
    content: [{ type: "text", text: `Unknown BGG tool: ${name}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// BGG Search
// ---------------------------------------------------------------------------

async function bggSearch(query: string, exact: 0 | 1) {
  try {
    const xml = await bggGet(`${BGG_API}/search`, { query, type: "boardgame", exact });
    const parsed = xmlParser.parse(xml);
    const items: any[] = parsed?.items?.item ?? [];

    if (!items.length) {
      return {
        content: [
          {
            type: "text",
            text: `No games found on BoardGameGeek for query: "${query}".`,
          },
        ],
      };
    }

    const results = items.slice(0, 20).map((item: any) => {
      const names: any[] = Array.isArray(item.name) ? item.name : [item.name];
      const primaryName =
        names.find((n: any) => n?.["@_type"] === "primary")?.[
          "@_value"
        ] ?? names[0]?.["@_value"] ?? "Unknown";
      const year = item.yearpublished?.["@_value"];
      return `- ID: ${item["@_id"]}  —  ${primaryName}${year ? ` (${year})` : ""}`;
    });

    return {
      content: [
        {
          type: "text",
          text:
            `## BoardGameGeek Search: "${query}"\n\n` +
            `Found ${items.length} result(s). Use bgg_get_game_info with an ID for full details.\n\n` +
            results.join("\n"),
        },
      ],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error searching BGG: ${msg}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// BGG Game Details
// ---------------------------------------------------------------------------

async function bggGetGameInfo(
  id: number | undefined,
  name: string | undefined
) {
  try {
    // If only a name was provided, resolve it to an ID first
    if (!id && name) {
      const searchXml = await bggGet(`${BGG_API}/search`, { query: name, type: "boardgame", exact: 1 });
      const parsed = xmlParser.parse(searchXml);
      const items: any[] = parsed?.items?.item ?? [];
      if (!items.length) {
        // Retry fuzzy
        const fuzzyXml = await bggGet(`${BGG_API}/search`, { query: name, type: "boardgame", exact: 0 });
        const fuzzy = xmlParser.parse(fuzzyXml);
        const fuzzyItems: any[] = fuzzy?.items?.item ?? [];
        if (!fuzzyItems.length) {
          return {
            content: [
              {
                type: "text",
                text: `Could not find a game named "${name}" on BoardGameGeek. Try bgg_search_game to find the correct name or ID.`,
              },
            ],
            isError: true,
          };
        }
        id = Number(fuzzyItems[0]["@_id"]);
      } else {
        id = Number(items[0]["@_id"]);
      }
    }

    if (!id) {
      return {
        content: [
          {
            type: "text",
            text: "Please provide either a BGG game 'id' or a game 'name'.",
          },
        ],
        isError: true,
      };
    }

    const xml = await bggGet(`${BGG_API}/thing`, { id, type: "boardgame", stats: 1 });
    const parsed = xmlParser.parse(xml);
    const items: any[] = parsed?.items?.item ?? [];
    if (!items.length) {
      return {
        content: [
          {
            type: "text",
            text: `No game found on BoardGameGeek for ID ${id}.`,
          },
        ],
        isError: true,
      };
    }

    const game = items[0];
    return { content: [{ type: "text", text: formatGameInfo(game, id) }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error fetching BGG game info: ${msg}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatGameInfo(game: any, id: number): string {
  const names: any[] = Array.isArray(game.name) ? game.name : [game.name ?? []];
  const primaryName =
    names.find((n: any) => n?.["@_type"] === "primary")?.["@_value"] ??
    "Unknown";
  const altNames = names
    .filter((n: any) => n?.["@_type"] === "alternate")
    .map((n: any) => n["@_value"]);

  const year = game.yearpublished?.["@_value"] ?? "?";
  const minPlayers = game.minplayers?.["@_value"];
  const maxPlayers = game.maxplayers?.["@_value"];
  const minTime = game.minplaytime?.["@_value"];
  const maxTime = game.maxplaytime?.["@_value"];
  const age = game.minage?.["@_value"];

  const description = decodeEntities(
    typeof game.description === "string" ? game.description : ""
  );

  const links: any[] = Array.isArray(game.link) ? game.link : [game.link ?? []];

  const linksByType = (type: string) =>
    links
      .filter((l: any) => l?.["@_type"] === type)
      .map((l: any) => l["@_value"])
      .filter(Boolean);

  const categories = linksByType("boardgamecategory");
  const mechanics = linksByType("boardgamemechanic");
  const designers = linksByType("boardgamedesigner");
  const publishers = linksByType("boardgamepublisher").slice(0, 5);
  const families = linksByType("boardgamefamily").slice(0, 5);

  const ratings = game.statistics?.ratings;
  const avgRating = ratings?.average?.["@_value"]
    ? `${parseFloat(ratings.average["@_value"]).toFixed(2)} / 10`
    : "N/A";
  const bayesRating = ratings?.bayesaverage?.["@_value"]
    ? parseFloat(ratings.bayesaverage["@_value"]).toFixed(2)
    : "N/A";
  const usersRated = ratings?.usersrated?.["@_value"] ?? "N/A";
  const owned = ratings?.owned?.["@_value"] ?? "N/A";

  const ranks: any[] = Array.isArray(ratings?.ranks?.rank)
    ? ratings.ranks.rank
    : ratings?.ranks?.rank
    ? [ratings.ranks.rank]
    : [];
  const boardgameRank =
    ranks.find((r: any) => r?.["@_name"] === "boardgame")?.["@_value"] ??
    "Not ranked";

  const playerRange =
    minPlayers && maxPlayers
      ? minPlayers === maxPlayers
        ? `${minPlayers}`
        : `${minPlayers}–${maxPlayers}`
      : "?";

  const timeRange =
    minTime && maxTime
      ? minTime === maxTime
        ? `${minTime} min`
        : `${minTime}–${maxTime} min`
      : minTime
      ? `${minTime} min`
      : "?";

  const lines: string[] = [
    `## ${primaryName} (${year})`,
    ``,
    `**BGG ID**: ${id}  |  **BGG Rank**: #${boardgameRank}`,
    `**BGG URL**: https://boardgamegeek.com/boardgame/${id}`,
    ``,
    `### At a Glance`,
    `| Property | Value |`,
    `|---|---|`,
    `| Players | ${playerRange} |`,
    `| Play Time | ${timeRange} |`,
    `| Age | ${age ? `${age}+` : "?"} |`,
    `| Avg Rating | ${avgRating} (Bayes: ${bayesRating}) |`,
    `| Users Rated | ${Number(usersRated).toLocaleString()} |`,
    `| Copies Owned | ${Number(owned).toLocaleString()} |`,
  ];

  if (designers.length) {
    lines.push(`| Designer(s) | ${designers.join(", ")} |`);
  }
  if (publishers.length) {
    lines.push(
      `| Publisher(s) | ${publishers.join(", ")}${publishers.length < (game.link?.filter?.((l: any) => l?.["@_type"] === "boardgamepublisher")?.length ?? 0) ? ", …" : ""} |`
    );
  }

  if (categories.length) {
    lines.push(``, `### Categories`, categories.map((c) => `- ${c}`).join("\n"));
  }

  if (mechanics.length) {
    lines.push(``, `### Mechanics`, mechanics.map((m) => `- ${m}`).join("\n"));
  }

  if (families.length) {
    lines.push(``, `### Families`, families.map((f) => `- ${f}`).join("\n"));
  }

  if (altNames.length) {
    lines.push(
      ``,
      `### Also Known As`,
      altNames.slice(0, 10).map((n) => `- ${n}`).join("\n")
    );
  }

  if (description) {
    // Trim description to a reasonable length
    const trimmed =
      description.length > 2000
        ? description.slice(0, 2000).trimEnd() + "…"
        : description;
    lines.push(``, `### Description`, trimmed);
  }

  return lines.join("\n");
}

/** Decode common HTML entities returned by the BGG API description field. */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}
