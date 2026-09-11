// A small XML reader for the MSPDI subset: elements, text, CDATA, comments, entities. No
// attributes are needed (MSPDI carries everything as child elements) and no DOM is
// available in the test environment, so this stays dependency-free.

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Parse a document into its root element. Throws on a mismatched close tag. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: "", children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) { const e = src.indexOf(">", lt); i = e < 0 ? n : e + 1; continue; }
    const gt = src.indexOf(">", lt);
    if (gt < 0) break;
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: unexpected </${name}>`);
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const name = (selfClosing ? raw.slice(0, -1) : raw).split(/\s/)[0];
    const node: XmlNode = { name, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0] ?? root;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

export function text(node: XmlNode | undefined, name: string): string | undefined {
  const c = node && child(node, name);
  return c ? c.text.trim() : undefined;
}
