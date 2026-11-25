import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "react-native": path.resolve("tests/native.ts") } },
});
