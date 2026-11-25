#!/usr/bin/env node
/**
 * Tauri embeds the configured PNG icons into the binary at compile time.
 *
 * Its PNG reader copies the file's raw samples but hands the image to tao as
 * 8-bit RGBA, so a 16-bit-per-channel PNG is embedded with twice as many bytes
 * as its dimensions allow. The app then panics during setup with:
 *
 *   Failed to setup app: runtime error: invalid icon: The specified dimensions
 *   (32x32) don't match the number of pixels supplied by the `rgba` argument
 *
 * Keep every bundle PNG at 8-bit RGBA so the embedded icon stays valid.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

const CONFIGS = [
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.macos.conf.json",
  "src-tauri/tauri.linux.conf.json",
  "src-tauri/tauri.windows.conf.json",
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads the bit depth and colour type from the PNG's IHDR chunk. */
function readHeader(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 29 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file} is not a PNG file`);
  }

  const length = bytes.readUInt32BE(8);
  const type = bytes.toString("ascii", 12, 16);
  if (type !== "IHDR" || length !== 13) {
    throw new Error(`${file} does not start with an IHDR chunk`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

// Icon paths are relative to the config file that lists them.
const files = new Map();
for (const configFile of CONFIGS) {
  const configPath = resolvePath(root, configFile);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }

  for (const icon of config.bundle?.icon ?? []) {
    if (!icon.endsWith(".png")) continue;
    const iconPath = resolvePath(dirname(configPath), icon);
    files.set(iconPath, relative(root, iconPath));
  }
}

if (files.size === 0) {
  console.error("No bundle PNG icons were found in the Tauri configs.");
  process.exit(1);
}

const problems = [];
for (const [file, display] of files) {
  const { width, height, bitDepth, colorType } = readHeader(file);

  if (width === 0 || height === 0) {
    problems.push(`${display}: image has no pixels`);
  }
  if (colorType !== 6) {
    problems.push(`${display}: colour type is ${colorType}, expected 6 (RGBA)`);
  }
  if (bitDepth !== 8) {
    problems.push(`${display}: bit depth is ${bitDepth}, expected 8`);
  }
}

if (problems.length > 0) {
  console.error("Bundle icons must be 8-bit RGBA PNGs:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "Regenerate them with `npm run tauri icon <source>` or export them as 8-bit RGBA.",
  );
  process.exit(1);
}

console.log(`All ${files.size} bundle PNG icons are 8-bit RGBA.`);
