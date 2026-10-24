// [[D102]] graphOnCore
// What a node class is built from: a node with keyed input and output ports, each holding a socket, and the cable
// between two of them. While a node is in an editor its port changes are made in the graph core too
// (tree/specs/computation/graph-core.md § The model), so `inputs` and `outputs` change only through these methods.
import { uid } from "./graphWasm/solenoid_graph.js";

/** A node's or cable's id, made by the graph core (Ruggine's `getUID`: sixteen lowercase hex digits from eight
 *  random bytes), so nothing can be built before the module loads. */
export function getUID(): string {
  return uid();
}

/** Where a node's port changes go: the editors holding it, which send the node's ports to the core as they stand. */
export interface PortListener {
  portsMoved(node: GraphNode): void;
}

/** A socket: its `name` is the type the core records for every port holding it. */
export class GraphSocket {
  constructor(public name: string) {}

  /** Whether the name can change in place, so the socket must know the ports holding it. */
  protected get renames(): boolean { return false; }

  attach(port: GraphPort): void {
    if (!this.renames) return;
    const held = holders.get(this);
    if (held) held.add(port);
    else holders.set(this, new Set([port]));
  }

  detach(port: GraphPort): void {
    holders.get(this)?.delete(port);
  }

  /** Changes the name, telling every port that holds the socket. */
  protected rename(name: string): void {
    if (name === this.name) return;
    this.name = name;
    for (const port of holders.get(this) ?? []) port.retyped();
  }
}

/** Which node holds each port, and who hears each node's port changes: off the objects, so a node's own keys are
 *  its fields alone. */
const seats = new WeakMap<GraphPort, GraphNode>();
const holders = new WeakMap<GraphSocket, Set<GraphPort>>();
const listeners = new WeakMap<GraphNode, PortListener[]>();

export class GraphPort<S extends GraphSocket = GraphSocket> {
  index?: number;
  private _socket: S;

  constructor(socket: S, public label?: string, public multipleConnections?: boolean) {
    this._socket = socket;
  }

  get socket(): S { return this._socket; }

  /** Swapping the socket in place retypes the port in the core. */
  set socket(socket: S) {
    if (seats.has(this)) { this._socket.detach(this); socket.attach(this); }
    this._socket = socket;
    this.retyped();
  }

  retyped(): void {
    seats.get(this)?.portRetyped();
  }
}

export class GraphInput<S extends GraphSocket = GraphSocket> extends GraphPort<S> {
  constructor(socket: S, label?: string, multipleConnections?: boolean) {
    super(socket, label, multipleConnections);
  }
}

export class GraphOutput<S extends GraphSocket = GraphSocket> extends GraphPort<S> {
  constructor(socket: S, label?: string, multipleConnections?: boolean) {
    super(socket, label, multipleConnections !== false);
  }
}

export type GraphInputs = { readonly [key: string]: GraphInput | undefined };
export type GraphOutputs = { readonly [key: string]: GraphOutput | undefined };

export class GraphNode {
  id = getUID();
  readonly inputs: GraphInputs = {};
  readonly outputs: GraphOutputs = {};
  declare selected?: boolean;

  constructor(public label: string) {}

  hasInput(key: string): boolean { return Object.prototype.hasOwnProperty.call(this.inputs, key); }
  hasOutput(key: string): boolean { return Object.prototype.hasOwnProperty.call(this.outputs, key); }

  addInput(key: string, input: GraphInput): void {
    if (this.hasInput(key)) throw new Error(`input with key '${key}' already added`);
    this.seat(false, key, input);
  }

  addOutput(key: string, output: GraphOutput): void {
    if (this.hasOutput(key)) throw new Error(`output with key '${key}' already added`);
    this.seat(true, key, output);
  }

  removeInput(key: string): void { this.unseat(false, key); }
  removeOutput(key: string): void { this.unseat(true, key); }

  /** Re-seats an input after the others, the order a reload rebuilds. */
  moveInputLast(key: string): void {
    const input = this.inputs[key];
    if (!input) return;
    this.unseat(false, key);
    this.seat(false, key, input);
  }

  /** The editor holding the node hears its port changes; `listen(l, false)` stops that. */
  listen(listener: PortListener, on: boolean): void {
    const list = listeners.get(this) ?? [];
    const at = list.indexOf(listener);
    if (on && at < 0) list.push(listener);
    if (!on && at >= 0) list.splice(at, 1);
    if (list.length) listeners.set(this, list);
    else listeners.delete(this);
  }

  portRetyped(): void {
    for (const l of listeners.get(this) ?? []) l.portsMoved(this);
  }

  private seat(output: boolean, key: string, port: GraphPort): void {
    const ports = (output ? this.outputs : this.inputs) as Record<string, GraphPort>;
    Object.defineProperty(ports, key, { value: port, enumerable: true, configurable: true, writable: true });
    seats.set(port, this);
    port.socket.attach(port);
    for (const l of listeners.get(this) ?? []) l.portsMoved(this);
  }

  private unseat(output: boolean, key: string): void {
    const ports = (output ? this.outputs : this.inputs) as Record<string, GraphPort | undefined>;
    const port = ports[key];
    if (!port || !Object.prototype.hasOwnProperty.call(ports, key)) return;
    delete ports[key];
    seats.delete(port);
    port.socket.detach(port);
    for (const l of listeners.get(this) ?? []) l.portsMoved(this);
  }
}

/** A cable from one node's output to another's input. */
export class GraphConnection<A extends GraphNode = GraphNode, B extends GraphNode = GraphNode> {
  id: string;
  source: string;
  target: string;

  constructor(source: A, public sourceOutput: string, target: B, public targetInput: string) {
    if (!source.outputs[sourceOutput]) throw new Error(`source node doesn't have output with a key ${sourceOutput}`);
    if (!target.inputs[targetInput]) throw new Error(`target node doesn't have input with a key ${targetInput}`);
    this.id = getUID();
    this.source = source.id;
    this.target = target.id;
  }
}

/** The node and cable types an editor holds. */
export type GraphSchemes = { Node: GraphNode; Connection: { id: string; source: string; target: string; sourceOutput: string; targetInput: string } };
