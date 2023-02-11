import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: { server: "./src/index.ts" },
		format: ["esm", "cjs"],
		platform: "neutral",
		target: "node14",
		clean: true,
		define: { SERVER_BUILD: "true" },
	},
	{
		entry: { browser: "./src/index.ts" },
		format: ["esm"],
		platform: "browser",
		target: "es2019",
		dts: {
			entry: "./src/index.ts",
		},
		clean: true,
		define: { SERVER_BUILD: "false" },
	},
]);
