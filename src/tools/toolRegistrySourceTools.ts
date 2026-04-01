import { SourceCodeTools } from "./sourceCodeTools.js";
import type {
  PatchProposalNotifier,
  RegisteredTool,
  ToolRegistryOptions,
} from "./toolRegistryShared.js";
import { log } from "./toolRegistryShared.js";

export function buildSourceTools(
  options: ToolRegistryOptions,
  getPatchProposalNotifier: () => PatchProposalNotifier | undefined,
): RegisteredTool[] {
  if (!options.sourcePath) {
    return [];
  }

  const sourceTools = new SourceCodeTools({
    sourcePath: options.sourcePath,
    proposalDir: options.proposalDir,
  });

  return [
    {
      definition: {
        type: "function",
        function: {
          name: "search_code",
          description: "Searches source files under RUST_MULE_SOURCE_PATH for literal text matches.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Literal text query to search for.",
              },
            },
            required: ["query"],
          },
        },
      },
      handler: async (args) => {
        const query = typeof args["query"] === "string" ? args["query"] : "";
        return sourceTools.searchCode(query);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "read_file",
          description: "Reads a source file relative to RUST_MULE_SOURCE_PATH with bounded output.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Relative path to the file to read.",
              },
            },
            required: ["path"],
          },
        },
      },
      handler: async (args) => {
        const path = typeof args["path"] === "string" ? args["path"] : "";
        return sourceTools.readFile(path);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "show_function",
          description:
            "Finds function definitions by name in source files under RUST_MULE_SOURCE_PATH.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Function name to locate.",
              },
            },
            required: ["name"],
          },
        },
      },
      handler: async (args) => {
        const name = typeof args["name"] === "string" ? args["name"] : "";
        return sourceTools.showFunction(name);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "propose_patch",
          description: "Stores a patch proposal artifact for human review only; does not apply changes.",
          parameters: {
            type: "object",
            properties: {
              diff: {
                type: "string",
                description: "Unified diff proposal text.",
              },
            },
            required: ["diff"],
          },
        },
      },
      handler: async (args) => {
        const diff = typeof args["diff"] === "string" ? args["diff"] : "";
        const proposal = await sourceTools.proposePatch(diff);
        const notifier = getPatchProposalNotifier();
        if (notifier) {
          try {
            await notifier({
              artifactPath: proposal.artifactPath,
              diff: diff.trim(),
              bytes: proposal.bytes,
              lines: proposal.lines,
            });
          } catch (err) {
            log("warn", "toolRegistry", `Patch proposal notification failed: ${String(err)}`);
          }
        }
        return proposal;
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "git_blame",
          description: "Runs git blame for a specific file and line under RUST_MULE_SOURCE_PATH.",
          parameters: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Relative file path.",
              },
              line: {
                type: "number",
                description: "1-based line number.",
              },
            },
            required: ["file", "line"],
          },
        },
      },
      handler: async (args) => {
        const file = typeof args["file"] === "string" ? args["file"] : "";
        const line = typeof args["line"] === "number" ? args["line"] : 1;
        return sourceTools.gitBlame(file, line);
      },
    },
  ];
}
