import { ReverseTextNode as ReverseTextNodeType, SpellNumberNode as SpellNumberNodeType } from "../rete-nodes";
import { makeNodeComponent, makeToggleNodeComponent } from "./standardNode";

export const ReverseTextComponent = makeNodeComponent<ReverseTextNodeType>((n) => n.cachedText);

export const SpellNumberComponent = makeToggleNodeComponent<SpellNumberNodeType, SpellNumberNodeType["mode"]>(
  {
    read: (n) => n.mode,
    write: (n, m) => n.setMode(m),
    options: [
      { value: "words", label: "words", title: "Spell out in words: 42 → forty-two" },
      { value: "ordinal", label: "ordinal", title: "Ordinal form: 42 → 42nd" },
    ],
  },
  (n) => n.cachedText,
);
