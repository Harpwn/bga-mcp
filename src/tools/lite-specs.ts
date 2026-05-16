import fs from "node:fs";
import path from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WORKSPACE_PATH } from "../config.js";

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

interface MethodSig {
  name: string;
  params: string;
  returns: string;
}

const SPEC_FILES = [
  "design.md",
  "requirements.md",
  "runtime-api.md",
  "tasks.md",
  "example-scenario-test.md",
] as const;

function resolveSpecsDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "bga-lite", "specs"),
    path.join(cwd, "..", "bga-lite", "specs"),
    ...(WORKSPACE_PATH
      ? [
          path.join(WORKSPACE_PATH, "bga-lite", "specs"),
          path.join(WORKSPACE_PATH, "specs"),
          path.join(WORKSPACE_PATH, "..", "bga-lite", "specs"),
        ]
      : []),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return p;
    }
  }

  return null;
}

function readSpec(specsDir: string, fileName: string): string {
  return fs.readFileSync(path.join(specsDir, fileName), "utf8");
}

function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Untitled";
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`##\\s+${escaped}\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  return re.exec(markdown)?.[1]?.trim() ?? "";
}

function extractTsCodeBlock(markdown: string): string {
  const match = markdown.match(/```ts\n([\s\S]*?)\n```/);
  return match?.[1] ?? "";
}

function extractInterfaceMethods(code: string, interfaceName: string): MethodSig[] {
  const interfaceRe = new RegExp(
    `interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`,
    "m"
  );
  const body = interfaceRe.exec(code)?.[1] ?? "";
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("readonly "));

  const methods: MethodSig[] = [];
  for (const line of lines) {
    const m = line.match(/^(\w+)\(([^)]*)\):\s*([^;]+);$/);
    if (!m) continue;
    methods.push({ name: m[1], params: m[2], returns: m[3] });
  }

  return methods;
}

function findMissingSpecs(specsDir: string): string[] {
  return SPEC_FILES.filter((f) => !fs.existsSync(path.join(specsDir, f)));
}

function noSpecsDirError(): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text:
          "Could not locate bga-lite/specs directory. " +
          "Checked common workspace and sibling locations relative to this MCP server.",
      },
    ],
    isError: true,
  };
}

export const liteSpecTools: Tool[] = [
  {
    name: "bga_lite_list_specs",
    description:
      "List available bga-lite specification files and quick metadata. " +
      "Use this before reading or analyzing a spec file.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "bga_lite_get_spec",
    description:
      "Read the full content of a bga-lite spec file from bga-lite/specs (design, requirements, runtime-api, tasks, example-scenario-test).",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Spec file name (e.g. 'runtime-api.md' or 'requirements.md').",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "bga_lite_runtime_contract",
    description:
      "Extract and summarize the canonical runtime/session contracts from bga-lite/specs/runtime-api.md, including method signatures and adapter mapping rules.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "bga_lite_mcp_adapter_blueprint",
    description:
      "Build an MCP adapter checklist and recommended tool surface based on current bga-lite specs (requirements, runtime-api, tasks).",
    inputSchema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          enum: ["all", "scenario", "debug", "adapters"],
          description:
            "Optional focus area for the blueprint. Defaults to 'all'.",
        },
      },
      required: [],
    },
  },
];

export async function handleLiteSpecTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const specsDir = resolveSpecsDir();
  if (!specsDir) {
    return noSpecsDirError();
  }

  if (name === "bga_lite_list_specs") {
    const missing = findMissingSpecs(specsDir);
    const rows = SPEC_FILES.filter((f) => fs.existsSync(path.join(specsDir, f))).map((f) => {
      const full = readSpec(specsDir, f);
      const title = extractTitle(full);
      const lineCount = full.split("\n").length;
      return `- ${f}: ${title} (${lineCount} lines)`;
    });

    const missingBlock =
      missing.length > 0
        ? `\n\nMissing expected files:\n${missing.map((m) => `- ${m}`).join("\n")}`
        : "";

    return {
      content: [
        {
          type: "text",
          text:
            `bga-lite specs directory: ${specsDir}\n\n` +
            `Available spec files:\n${rows.join("\n")}` +
            missingBlock,
        },
      ],
    };
  }

  if (name === "bga_lite_get_spec") {
    const file = String(args.file ?? "").trim();
    if (!file) {
      return {
        content: [{ type: "text", text: "Missing required argument: file" }],
        isError: true,
      };
    }

    const fullPath = path.join(specsDir, file);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return {
        content: [
          {
            type: "text",
            text:
              `Spec file not found: ${file}\n` +
              `Use bga_lite_list_specs to discover valid files.`,
          },
        ],
        isError: true,
      };
    }

    const text = fs.readFileSync(fullPath, "utf8");
    return {
      content: [
        {
          type: "text",
          text: `# bga-lite spec: ${file}\n\n${text}`,
        },
      ],
    };
  }

  if (name === "bga_lite_runtime_contract") {
    const runtimeApi = readSpec(specsDir, "runtime-api.md");
    const contractsCode = extractTsCodeBlock(runtimeApi);
    const runtimeMethods = extractInterfaceMethods(contractsCode, "Runtime");
    const sessionMethods = extractInterfaceMethods(contractsCode, "RuntimeSession");

    const scenarioRuleText = extractSection(runtimeApi, "Purpose")
      .split("\n")
      .filter((line) => line.trim().startsWith("- scenario"))
      .map((line) => line.trim().replace(/^-\s*/, ""));

    const mappingSection = extractSection(runtimeApi, "Adapter Mapping Rules")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.replace(/^-\s*/, ""));

    const payload = {
      source: path.join(specsDir, "runtime-api.md"),
      scenarioRules: scenarioRuleText,
      runtimeMethods,
      sessionMethods,
      adapterMappingRules: mappingSection,
    };

    return {
      content: [
        {
          type: "text",
          text:
            "Runtime contract extracted from bga-lite specs:\n\n" +
            JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  if (name === "bga_lite_mcp_adapter_blueprint") {
    const focus = String(args.focus ?? "all") as "all" | "scenario" | "debug" | "adapters";
    const requirements = readSpec(specsDir, "requirements.md");
    const runtimeApi = readSpec(specsDir, "runtime-api.md");
    const tasks = readSpec(specsDir, "tasks.md");

    const fr11 = requirements.match(/### FR-11 Optional MCP Adapter[\s\S]*?(?=\n### FR-|\n## )/)?.[0] ?? "";
    const adapterMapping = extractSection(runtimeApi, "Adapter Mapping Rules");
    const milestoneG = tasks.match(/## 8\. Milestone G: Optional Adapters[\s\S]*?(?=\n## )/)?.[0] ?? "";

    const coreTools = [
      {
        name: "bga_runtime_create_session",
        mapsTo: "runtime.createSession",
        notes: "Support scenario and debug modes. Scenario mode must reject persist attach and explicit reset input.",
      },
      {
        name: "bga_runtime_load_session",
        mapsTo: "runtime.loadSession",
        notes: "For debug workflows only.",
      },
      {
        name: "bga_runtime_list_sessions",
        mapsTo: "runtime.listSessions",
        notes: "Report mode, seed, determinism metadata.",
      },
      {
        name: "bga_session_get_state",
        mapsTo: "session.getState",
        notes: "Return state summary and full machine payload.",
      },
      {
        name: "bga_session_get_players",
        mapsTo: "session.getPlayers",
        notes: "Expose player slots and active IDs from state context.",
      },
      {
        name: "bga_session_perform_action",
        mapsTo: "session.performAction",
        notes: "Return structured ActionStepResult and plain-language change summary.",
      },
      {
        name: "bga_session_reset",
        mapsTo: "session.resetSession",
        notes: "Allowed for debug sessions. Scenario flows should rely on implicit clean baseline.",
      },
      {
        name: "bga_session_timeline",
        mapsTo: "session.getEventTimeline",
        notes: "Support debugging and deterministic trace checks.",
      },
      {
        name: "bga_session_warnings",
        mapsTo: "session.getWarnings",
        notes: "Expose shim/parity risks.",
      },
      {
        name: "bga_session_close",
        mapsTo: "session.closeSession",
        notes: "Explicit lifecycle closure.",
      },
    ];

    const filteredTools = coreTools.filter((tool) => {
      if (focus === "all") return true;
      if (focus === "scenario") {
        return !tool.name.includes("load_session") && !tool.name.includes("list_sessions");
      }
      if (focus === "debug") {
        return !tool.name.includes("scenario");
      }
      return true;
    });

    const output = [
      `bga-lite MCP adapter blueprint (focus: ${focus})`,
      "",
      "Recommended MCP tools:",
      ...filteredTools.map(
        (tool) => `- ${tool.name}: ${tool.mapsTo} - ${tool.notes}`
      ),
      "",
      "Spec anchors:",
      "- FR-11 Optional MCP Adapter",
      "- runtime-api Adapter Mapping Rules",
      "- tasks Milestone G Optional Adapters",
      "",
      "Extracted FR-11:",
      fr11 || "(section not found)",
      "",
      "Extracted adapter mapping:",
      adapterMapping || "(section not found)",
      "",
      "Extracted Milestone G:",
      milestoneG || "(section not found)",
    ].join("\n");

    return {
      content: [{ type: "text", text: output }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown bga-lite spec tool: ${name}` }],
    isError: true,
  };
}
