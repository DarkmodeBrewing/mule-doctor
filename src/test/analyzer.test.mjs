import test from "node:test";
import assert from "node:assert/strict";

import { Analyzer } from "../../dist/llm/analyzer.js";

class StubToolRegistry {
  constructor() {
    this.calls = [];
  }

  getDefinitions() {
    return [
      {
        type: "function",
        function: {
          name: "getNodeInfo",
          description: "stub",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ];
  }

  async invoke(name, args) {
    this.calls.push({ name, args });
    return {
      tool: name,
      success: true,
      data: { ok: true },
    };
  }
}

function toolCall(id, name, args = {}) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function completion(message, finishReason = "stop") {
  return {
    choices: [
      {
        finish_reason: finishReason,
        message,
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
    },
    model: "gpt-5-mini",
  };
}

test("Analyzer returns explicit message when tool round limit is reached", async () => {
  const tools = new StubToolRegistry();
  const analyzer = new Analyzer("test-key", tools, {
    maxToolRounds: 2,
    maxTotalToolCalls: 10,
    maxDurationMs: 10_000,
  });

  let calls = 0;
  analyzer.client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return completion(
            {
              content: null,
              tool_calls: [toolCall(`call-${calls}`, "getNodeInfo")],
            },
            "tool_calls",
          );
        },
      },
    },
  };

  const result = await analyzer.analyze("diagnose");

  assert.match(result, /tool round limit reached \(2\)/);
  assert.equal(tools.calls.length, 2);
});

test("Analyzer returns explicit message when total tool call limit is reached", async () => {
  const tools = new StubToolRegistry();
  const analyzer = new Analyzer("test-key", tools, {
    maxToolRounds: 5,
    maxTotalToolCalls: 2,
    maxDurationMs: 10_000,
  });

  analyzer.client = {
    chat: {
      completions: {
        create: async () =>
          completion(
            {
              content: null,
              tool_calls: [
                toolCall("call-1", "getNodeInfo"),
                toolCall("call-2", "getNodeInfo"),
                toolCall("call-3", "getNodeInfo"),
              ],
            },
            "tool_calls",
          ),
      },
    },
  };

  const result = await analyzer.analyze("diagnose");

  assert.match(result, /total tool call limit reached \(2\)/);
  assert.equal(tools.calls.length, 2);
});

test("Analyzer returns explicit message when analysis duration limit is reached", async () => {
  const tools = new StubToolRegistry();
  const analyzer = new Analyzer("test-key", tools, {
    maxToolRounds: 5,
    maxTotalToolCalls: 10,
    maxDurationMs: 5,
  });

  analyzer.client = {
    chat: {
      completions: {
        create: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return completion(
            {
              content: null,
              tool_calls: [toolCall("call-1", "getNodeInfo")],
            },
            "tool_calls",
          );
        },
      },
    },
  };

  const result = await analyzer.analyze("diagnose");

  assert.match(result, /analysis duration limit reached after 5ms/);
  assert.equal(tools.calls.length, 0);
});
