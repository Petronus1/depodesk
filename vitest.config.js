import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Polyfills a few browser globals pdfjs touches at import time; the app
    // itself only ever runs pdfjs in a real browser.
    setupFiles: ["./vitest.setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
