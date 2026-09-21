#!/usr/bin/env node
/**
 * Installs the Solidity dependencies ProofInvoice needs.
 *
 * vlayer does not publish its Solidity contracts to npm or to the Soldeer registry.
 * The supported distribution channel used by the official examples is the
 * `vlayer.zip` asset attached to a vlayer GitHub release
 * (see vlayer-xyz/vlayer `contracts/vlayer/foundry.toml` and
 *  `examples/simple-email-proof/soldeer.lock`).
 *
 * This script therefore pins exact release assets and verifies every archive
 * against a recorded SHA-256 digest before extracting it into `contracts/lib/`.
 * Re-running it is a no-op once the tree is present and valid.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const libDir = join(repoRoot, "contracts", "lib");
const cacheDir = join(repoRoot, ".cache", "solidity-deps");

export const VLAYER_VERSION = "v1.5.1";

/**
 * Pinned dependency set. Digests come from the authoritative lockfiles of the
 * upstream project:
 *  - vlayer.zip            -> GitHub release asset digest (vlayer-xyz/vlayer v1.5.1)
 *  - forge-std / openzeppelin / risc0-ethereum -> vlayer's soldeer.lock (checksum field)
 */
export const DEPENDENCIES = [
  {
    name: "vlayer",
    version: VLAYER_VERSION,
    url: `https://github.com/vlayer-xyz/vlayer/releases/download/${VLAYER_VERSION}/vlayer.zip`,
    sha256: "a43a139a35789e722f2d6317ded3be7ae393a4fe20e6a98a7ef83038198937e7",
    target: join(libDir, "vlayer"),
    marker: "src/Verifier.sol",
  },
  {
    name: "forge-std-1.9.4",
    version: "1.9.4",
    url: "https://soldeer-revisions.s3.amazonaws.com/forge-std/1_9_4_25-10-2024_14:36:59_forge-std-1.9.zip",
    sha256: "b5be24beb5e4dab5e42221b2ad1288b64c826bee5ee71b6159ba93ffe86f14d4",
    target: join(libDir, "forge-std-1.9.4"),
    marker: "src/Test.sol",
  },
  {
    name: "openzeppelin-contracts-5.0.1",
    version: "5.0.1",
    url: "https://soldeer-revisions.s3.amazonaws.com/@openzeppelin-contracts/5_0_1_22-01-2024_13:14:01_contracts.zip",
    sha256: "c256cbf6f5f38d3b65c7528bbffb530d0bdb818a20c9d5b61235a829202d7df7",
    target: join(libDir, "openzeppelin-contracts-5.0.1"),
    marker: "utils/Address.sol",
  },
  {
    name: "risc0-ethereum-3.0.0",
    version: "3.0.0",
    url: "https://github.com/vlayer-xyz/risc0-ethereum/releases/download/v3.0.0-soldeer/contracts.zip",
    sha256: "63001094019cc317ad989183ca89f321eb26275d0700fc79e222c553f0689b07",
    target: join(libDir, "risc0-ethereum-3.0.0"),
    marker: "src/IRiscZeroVerifier.sol",
  },
];

function log(message) {
  process.stdout.write(`[contracts:install] ${message}\n`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`download failed (${response.status} ${response.statusText}) for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  return bytes.length;
}

function extract(archive, target) {
  // `tar` (bsdtar) ships with Windows 10+, macOS and Linux and reads zip archives.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync("tar", ["-xf", archive, "-C", target], { stdio: "inherit" });
}

async function installOne(dep, { force }) {
  const markerPath = join(dep.target, dep.marker);
  if (!force && existsSync(markerPath)) {
    log(`ok    ${dep.name}@${dep.version} (already installed)`);
    return;
  }

  const archive = join(cacheDir, `${dep.name}.zip`);
  const cached = existsSync(archive) && sha256(archive) === dep.sha256;

  if (!cached) {
    log(`fetch ${dep.name}@${dep.version} <- ${dep.url}`);
    const size = await download(dep.url, archive);
    const digest = sha256(archive);
    if (digest !== dep.sha256) {
      rmSync(archive, { force: true });
      throw new Error(
        `checksum mismatch for ${dep.name}@${dep.version}\n  expected ${dep.sha256}\n  actual   ${digest}`,
      );
    }
    log(`      ${size} bytes, sha256 verified`);
  } else {
    log(`ok    ${dep.name}@${dep.version} (cached archive, sha256 verified)`);
  }

  extract(archive, dep.target);
  if (!existsSync(markerPath)) {
    throw new Error(`extracted ${dep.name} but ${dep.marker} is missing in ${dep.target}`);
  }
  log(`ok    ${dep.name}@${dep.version} extracted to ${dep.target}`);
}

async function main() {
  const force = process.argv.includes("--force");
  log(`installing into ${libDir}`);
  for (const dep of DEPENDENCIES) {
    await installOne(dep, { force });
  }
  log("all Solidity dependencies present");
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`[contracts:install] FAILED: ${error.message}\n`);
    process.exit(1);
  });
}