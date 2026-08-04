import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Two scopes:
 *   • `scope="app"` wraps the main React root — the full blackout case.
 *   • `scope="node"` wraps EACH rete-rendered node component. Rete gives every
 *     node its own React root, so one card that throws would otherwise blank the
 *     whole canvas; boundaried, the broken card shows as a small red box and every
 *     other node keeps working.
 *
 * The component stack matters more than the error stack here (minified builds
 * make the latter nearly useless), so it is shown first and copied too.
 */
type Props = { children: ReactNode; scope: "app" | "node"; label?: string };
type State = { error: Error | null; info: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    // Keep the console record too — a device with devtools attached gets the
    // live object, which is richer than the serialized text below.
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

/** Wrap a rete node component in a `scope="node"` boundary.
 *
 *  MEMOISED BY COMPONENT TYPE (the WeakMap): the render preset calls this on
 *  every node render, and returning a fresh component *type* each time would
 *  give React a different element type on every pass — it would unmount and
 *  remount the card, losing focus mid-edit and re-running every effect. Same
 *  input component ⇒ same wrapper identity. */
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
