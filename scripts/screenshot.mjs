#!/usr/bin/env node
/**
 * Captures docs/screenshot-demo.png from the running demo server
 * (npm run dev) using the system Chrome/Edge via puppeteer-core.
 * Waits until the parsed-claims table is rendered so the screenshot is
 * deterministic. Usage: node scripts/screenshot.mjs [url] [outfile]
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:3000/";
const out = process.argv[3] ?? "docs/screenshot-demo.png";

const candidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("no Chrome/Edge found; install one or pass puppeteer executablePath");
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1900 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  // Wait for the parsed claims table produced from the auto-loaded fixture.
  await page.waitForFunction(
    () => document.querySelector("#parsed table") !== null,
    { timeout: 15_000 },
  );
  await page.screenshot({ path: out, fullPage: true });
  console.log(`screenshot written to ${out}`);
} finally {
  await browser.close();
}
