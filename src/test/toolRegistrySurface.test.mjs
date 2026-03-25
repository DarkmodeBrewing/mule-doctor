import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../../dist/tools/toolRegistry.js";
import { StubClient, StubLogWatcher } from "./toolRegistryTestHelpers.mjs";

test("ToolRegistry exposes keyword search, shared, and download investigation tools", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const searches = await registry.invoke("listKeywordSearches", {});
  const search = await registry.invoke("getKeywordSearch", { search_id: "search-1" });
  const sharedFiles = await registry.invoke("listSharedFiles", {});
  const sharedActions = await registry.invoke("listSharedActions", {});
  const downloads = await registry.invoke("getDownloads", {});

  assert.equal(searches.success, true);
  assert.equal(searches.data.ready, true);
  assert.equal(searches.data.searches[0].search_id_hex, "search-1");
  assert.equal(search.success, true);
  assert.equal(search.data.search.search_id_hex, "search-1");
  assert.equal(sharedFiles.success, true);
  assert.equal(sharedFiles.data.files[0].identity.file_name, "fixture.txt");
  assert.equal(sharedActions.success, true);
  assert.equal(sharedActions.data.actions[0].kind, "republish_keywords");
  assert.equal(downloads.success, true);
  assert.equal(downloads.data.downloads[0].state, "queued");
});

test("ToolRegistry exposes summarized search, shared, and download diagnostics", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const searchSummary = await registry.invoke("summarizeKeywordSearches", {});
  const sharedSummary = await registry.invoke("summarizeSharedLibrary", {});
  const downloadSummary = await registry.invoke("summarizeDownloads", {});
  const combinedSummary = await registry.invoke("summarizeSearchPublishDiagnostics", {});

  assert.equal(searchSummary.success, true);
  assert.equal(searchSummary.data.totalSearches, 2);
  assert.equal(searchSummary.data.activeSearches, 1);
  assert.equal(searchSummary.data.publishEnabledCount, 1);
  assert.equal(searchSummary.data.publishAckedCount, 1);
  assert.equal(searchSummary.data.zeroHitTerminalCount, 1);

  assert.equal(sharedSummary.success, true);
  assert.equal(sharedSummary.data.totalFiles, 2);
  assert.equal(sharedSummary.data.keywordPublishQueuedCount, 1);
  assert.equal(sharedSummary.data.keywordPublishFailedCount, 1);
  assert.equal(sharedSummary.data.keywordPublishAckedCount, 1);
  assert.equal(sharedSummary.data.activeTransferFileCount, 2);
  assert.equal(sharedSummary.data.sharedActionCounts.republish_keywords, 1);
  assert.equal(sharedSummary.data.publishJobSurface, "shared_file_status_only");

  assert.equal(downloadSummary.success, true);
  assert.equal(downloadSummary.data.queueLen, 2);
  assert.equal(downloadSummary.data.totalDownloads, 2);
  assert.equal(downloadSummary.data.activeDownloads, 2);
  assert.equal(downloadSummary.data.downloadsWithErrors, 1);
  assert.equal(downloadSummary.data.downloadsWithSources, 1);
  assert.equal(downloadSummary.data.avgProgressPct, 22.5);

  assert.equal(combinedSummary.success, true);
  assert.equal(combinedSummary.data.searches.totalSearches, 2);
  assert.equal(combinedSummary.data.sharedLibrary.totalFiles, 2);
  assert.equal(combinedSummary.data.downloads.totalDownloads, 2);
});
