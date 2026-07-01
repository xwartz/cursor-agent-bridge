import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: "esm",
  dts: true,
  sourcemap: false,
  clean: true,
  target: "node20",
  tsconfig: "tsconfig.build.json",
})
