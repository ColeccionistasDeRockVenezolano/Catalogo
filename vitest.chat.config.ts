import { mergeConfig } from "vitest/config";
import base from "./vitest.config";

// El chat no necesita descubrir los archivos históricos del almacén enlazado.
export default mergeConfig(base, {
  test: {
    include: ["test/unit/chat-*.test.ts", "test/contract/chat*.test.ts", "web/tests/unit/chat-*.test.ts"],
    exclude: ["**/reports/**", "**/node_modules/**", "**/.claude/**", "**/dist/**"],
  },
});
