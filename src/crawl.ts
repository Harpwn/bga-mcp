#!/usr/bin/env node
/**
 * Crawl all BGA Studio wiki pages and save them to docs/.
 * This is called automatically on first server startup, or run manually:
 *
 *   npm run crawl
 *
 * Use this to force a refresh of the cached docs.
 */

import { BGA_DOC_PAGES } from "./config.js";
import { crawlAllPages, DOCS_DIR } from "./resources.js";

console.log(`Crawling ${BGA_DOC_PAGES.length} BGA wiki pages → ${DOCS_DIR}\n`);

crawlAllPages()
  .then(({ ok, fail }) => {
    console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
    if (fail > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
