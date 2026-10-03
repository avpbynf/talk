import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface WindowConfig {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)), "utf8"),
) as { app: { windows: WindowConfig[] } };
const main = config.app.windows[0];

export interface WindowSize {
  name: string;
  width: number;
  height: number;
}

const wanted: WindowSize[] = [
  { name: "default", width: main.width, height: main.height },
  { name: "minimum", width: main.minWidth ?? main.width, height: main.minHeight ?? main.height },
  { name: "wide", width: 1280, height: 900 },
  { name: "large", width: 2200, height: 1300 },
];

/** The window sizes the layout is held to; the default and the minimum are one when the config says so. */
export const SIZES: WindowSize[] = wanted.filter(
  (size, index) => wanted.findIndex((other) => other.width === size.width && other.height === size.height) === index,
);

export const DEFAULT_SIZE = SIZES[0];
