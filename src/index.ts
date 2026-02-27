#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { listResources, readResource, ensureDocs, RESOURCE_URI_PREFIX } from "./resources.js";

import { docTools, handleDocTool } from "./tools/docs.js";
import { scaffoldTools, handleScaffoldTool } from "./tools/scaffold.js";
import { projectTools, handleProjectTool } from "./tools/project.js";
import { migrateTools, handleMigrateTool } from "./tools/migrate.js";
import { validateTools, handleValidateTool } from "./tools/validate.js";
import { bggTools, handleBggTool } from "./tools/bgg.js";

const server = new Server(
  {
    name: "bga-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions:
      "This server provides authoritative BGA Studio documentation and project tools. " +
      "IMPORTANT USAGE RULES:\n" +
      "1. Before answering ANY question about BGA game development (PHP game logic, JS interface, " +
      "state machines, notifications, deck management, scoring, debug functions, file structure, " +
      "deployment, etc.) — call bga_get_doc_page with the relevant alias FIRST.\n" +
      "2. If unsure which page to fetch, call bga_list_doc_pages to see all available topics, " +
      "then fetch the most relevant one(s).\n" +
      "3. Do NOT answer BGA-specific questions from training knowledge alone — the BGA framework " +
      "has changed significantly and documentation lookups ensure accuracy.\n" +
      "4. When working on a local BGA game project, use bga_list_project_files and " +
      "bga_read_project_file to read actual game files before suggesting changes.\n" +
      "5. Common alias quick reference: 'debugging' (debug_ functions, #[Debug] attribute), " +
      "'state_classes' (modern PHP states), 'notifications' (notify API), " +
      "'main_game_logic' (Game.php), 'game_interface' (Game.js), 'deck' (Deck component).",
  }
);

// Resources — pre-crawled BGA wiki pages (run `npm run crawl` first)
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: listResources(),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const text = readResource(uri);
  if (text === null) {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: `Unknown resource: ${uri}. Valid URIs start with ${RESOURCE_URI_PREFIX}`,
        },
      ],
    };
  }
  return {
    contents: [{ uri, mimeType: "text/markdown", text }],
  };
});

// Register all tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...docTools,
    ...scaffoldTools,
    ...projectTools,
    ...migrateTools,
    ...validateTools,
    ...bggTools,
  ],
}));

// Route tool calls to the appropriate handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (docTools.find((t: Tool) => t.name === name)) {
    return handleDocTool(name, args ?? {});
  }
  if (scaffoldTools.find((t: Tool) => t.name === name)) {
    return handleScaffoldTool(name, args ?? {});
  }
  if (projectTools.find((t: Tool) => t.name === name)) {
    return handleProjectTool(name, args ?? {});
  }
  if (migrateTools.find((t: Tool) => t.name === name)) {
    return handleMigrateTool(name, args ?? {});
  }
  if (validateTools.find((t: Tool) => t.name === name)) {
    return handleValidateTool(name, args ?? {});
  }
  if (bggTools.find((t: Tool) => t.name === name)) {
    return handleBggTool(name, args ?? {});
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  await ensureDocs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BGA MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
