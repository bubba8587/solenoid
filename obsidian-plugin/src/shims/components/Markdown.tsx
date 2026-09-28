// [[C107]] obsidianPlugin
import { useEffect, useRef } from "react";
import { Component, MarkdownRenderer } from "obsidian";
import { obsidianApp } from "../../obsidianApp";
import "../../../../src/graph/components/Markdown.css";

/** Obsidian renders the markdown, so the plugin carries no parser of its own. */
export function Markdown({ md }: { md: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const app = obsidianApp();
    if (!el || !app) return;
    const owner = new Component();
    owner.load();
    void MarkdownRenderer.render(app, md, el, "", owner);
    return () => {
      owner.unload();
      el.replaceChildren();
    };
  }, [md]);
  return <div ref={ref} className="sol-md" />;
}
