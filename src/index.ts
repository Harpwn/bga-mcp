#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

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
    },
  }
);

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("BGA MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
