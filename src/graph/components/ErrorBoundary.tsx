import { Component, type ErrorInfo, type ReactNode } from "react";

/** `scope="app"` wraps the main React root; `scope="node"` wraps EACH rete node,
 *  whose own React root would otherwise blank the whole canvas when one throws. */
type Props = { children: ReactNode; scope: "app" | "node"; label?: string };
type State = { error: Error | null; info: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    // The console keeps the LIVE object, richer than the serialized text below.
    console.error(`[${this.props.scope} boundary]`, this.props.label ?? "", error, info.componentStack);
  }

  private report(): string {
    const { error, info } = this.state;
    return [
      `${this.props.scope} boundary${this.props.label ? ` — ${this.props.label}` : ""}`,
      `${error?.name ?? "Error"}: ${error?.message ?? "(no message)"}`,
      "",
      "Component stack:",
      info.trim() || "(none)",
      "",
      "Stack:",
      error?.stack ?? "(none)",
    ].join("\n");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.scope === "node") {
      return (
        <div className="solenoid-errbound solenoid-errbound--node" title={this.report()}>
          <strong>{this.props.label ?? "Node"} failed to render</strong>
          <span>{error.message}</span>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(this.report())}>
            Copy details
          </button>
        </div>
      );
    }

    return (
      <div className="solenoid-errbound solenoid-errbound--app" role="alert">
        <h2>Something threw while rendering</h2>
        <p>
          The rest of the app stopped rather than showing you a blank screen. Your document is
          autosaved; reloading restores it.
        </p>
        <pre>{this.report()}</pre>
        <div className="solenoid-errbound__actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(this.report())}>
            Copy details
          </button>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

/** Wrap a rete node component in a `scope="node"` boundary, MEMOISED BY COMPONENT
 *  TYPE: a fresh wrapper type per render would remount the card, losing focus
 *  mid-edit and re-running every effect. */
const wrapped = new WeakMap<object, unknown>();

export function withNodeBoundary<T>(Comp: T | null): T | null {
  if (!Comp) return null;
  const key = Comp as unknown as object;
  const hit = wrapped.get(key);
  if (hit) return hit as T;
  const Inner = Comp as unknown as (props: NodeProps) => ReactNode;
  const Wrapped = (props: NodeProps) => (
    <ErrorBoundary scope="node" label={props?.data?.label}>
      <Inner {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `Boundary(${(Inner as { displayName?: string; name?: string }).displayName ?? (Inner as { name?: string }).name ?? "Node"})`;
  wrapped.set(key, Wrapped);
  return Wrapped as unknown as T;
}

type NodeProps = { data?: { label?: string } } & Record<string, unknown>;
