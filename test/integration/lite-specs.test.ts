import { describe, expect, it } from "vitest";
import {
  handleLiteSpecTool,
  liteSpecTools,
} from "../../src/tools/lite-specs.js";

describe("bga-lite spec tools", () => {
  it("registers expected spec tool names", () => {
    const names = new Set(liteSpecTools.map((t) => t.name));

    expect(names.has("bga_lite_list_specs")).toBe(true);
    expect(names.has("bga_lite_get_spec")).toBe(true);
    expect(names.has("bga_lite_runtime_contract")).toBe(true);
    expect(names.has("bga_lite_mcp_adapter_blueprint")).toBe(true);
  });

  it("lists available specs", async () => {
    const result = await handleLiteSpecTool("bga_lite_list_specs", {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Available spec files");
    expect(result.content[0].text).toContain("runtime-api.md");
  });

  it("reads a specific spec", async () => {
    const result = await handleLiteSpecTool("bga_lite_get_spec", {
      file: "runtime-api.md",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("# bga-lite spec: runtime-api.md");
    expect(result.content[0].text).toContain("Runtime API Specification");
  });

  it("extracts runtime contract", async () => {
    const result = await handleLiteSpecTool("bga_lite_runtime_contract", {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Runtime contract extracted");
    expect(result.content[0].text).toContain("runtimeMethods");
    expect(result.content[0].text).toContain("sessionMethods");
  });

  it("builds MCP adapter blueprint", async () => {
    const result = await handleLiteSpecTool("bga_lite_mcp_adapter_blueprint", {
      focus: "all",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("MCP adapter blueprint");
    expect(result.content[0].text).toContain("bga_session_perform_action");
    expect(result.content[0].text).toContain("FR-11 Optional MCP Adapter");
  });
});
