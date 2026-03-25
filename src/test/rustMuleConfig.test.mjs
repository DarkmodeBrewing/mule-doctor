import test from "node:test";
import assert from "node:assert/strict";

import {
  parseManagedRustMuleConfigTemplateInput,
  parseManagedRustMuleConfigTemplateJson,
} from "../../dist/instances/rustMuleConfig.js";

test("parseManagedRustMuleConfigTemplateInput accepts the bounded nested and flat template contract", () => {
  const template = parseManagedRustMuleConfigTemplateInput({
    sam: {
      host: "127.0.0.1",
      forwardHost: "127.0.0.2",
    },
    generalLogLevel: "debug",
    api: {
      authMode: "local_ui",
    },
    sessionNamePrefix: "managed",
    sharingShareRoots: ["/srv/fixtures"],
  });

  assert.deepEqual(template, {
    sam: {
      host: "127.0.0.1",
      forwardHost: "127.0.0.2",
    },
    generalLogLevel: "debug",
    api: {
      authMode: "local_ui",
    },
    sessionNamePrefix: "managed",
    sharingShareRoots: ["/srv/fixtures"],
  });
});

test("parseManagedRustMuleConfigTemplateInput rejects unsupported keys and invalid field types", () => {
  assert.throws(
    () =>
      parseManagedRustMuleConfigTemplateInput({
        unsupported: true,
      }),
    /unsupported top-level keys: unsupported/,
  );

  assert.throws(
    () =>
      parseManagedRustMuleConfigTemplateInput({
        sam: {
          host: 123,
        },
      }),
    /field 'sam\.host' must be a string/,
  );
});

test("parseManagedRustMuleConfigTemplateJson rejects invalid JSON and ownership conflicts", () => {
  assert.throws(
    () => parseManagedRustMuleConfigTemplateJson("{"),
    /Invalid managed rust-mule config template JSON/,
  );

  assert.throws(
    () =>
      parseManagedRustMuleConfigTemplateJson(
        JSON.stringify({
          sam: {
            sessionName: "forbidden",
          },
        }),
      ),
    /may not set mule-doctor-owned keys: sam\.session_name/,
  );

  assert.throws(
    () =>
      parseManagedRustMuleConfigTemplateInput({
        apiPort: "19000",
      }),
    /may not set mule-doctor-owned keys: api\.port/,
  );
});
