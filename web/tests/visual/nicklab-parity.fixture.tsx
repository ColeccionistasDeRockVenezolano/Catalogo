import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { StyledName } from "../../src/components/chat/StyledName";
import { nameStyleSchema, NAME_STYLE_REFERENCES } from "../../../src/chat/name-style";
const root = createRoot(document.getElementById("root")!);
Object.assign(window, { nickReferences: Object.fromEntries(NAME_STYLE_REFERENCES.map(ref => [ref.code, ref.style])), renderNick: (name: string, input: unknown) => {
  flushSync(() => root.render(<StyledName name={name} style={nameStyleSchema.parse(input)} quality="high" />));
} });
