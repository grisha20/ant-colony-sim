import { defineConfig, searchForWorkspaceRoot } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  }
});
