let wasm;
let __wbg_epoch = 0;

const heap = new Array(128).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) { return heap[idx]; }

let heap_next = heap.length;

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export_0(addHeapObject(e));
    }
}

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => {
    if (state.epoch !== __wbg_epoch) return;
    wasm.__wbindgen_export_1.get(state.dtor)(state.a, state.b)
});

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor, epoch: __wbg_epoch };
    const real = (...args) => {
        if (state.epoch !== __wbg_epoch) return;
        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            if (--state.cnt === 0) {
                wasm.__wbindgen_export_1.get(state.dtor)(a, state.b);
                CLOSURE_DTORS.unregister(state);
            } else {
                state.a = a;
            }
        }
    };
    real.original = state;
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}
/**
 * `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
 * it and instantiate the module afresh.
 * @param {Function} handler
 */
export function setPanicHandler(handler) {
    wasm.setPanicHandler(addHeapObject(handler));
}

/**
 * Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
 */
export function graphTrap() {
    wasm.graphTrap();
}

/**
 * A node outside any editor computed on `inputs` through the input boundary, calling `data` (its own `data()` when
 * none): the outputs at once when nothing it does waits, else a promise of them. For tests and scripts that drive one
 * node.
 * @param {object} node
 * @param {any} inputs
 * @param {Function | null} [data]
 * @returns {any}
 */
export function computeNode(node, inputs, data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.computeNode(retptr, addHeapObject(node), addHeapObject(inputs), isLikeNone(data) ? 0 : addHeapObject(data));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

export function sessionMarkTopoDirty() {
    wasm.sessionMarkTopoDirty();
}

/**
 * A request for a pass: `"gated"` (manual mode marked the graph dirty), `"queued"` (a pass in flight reruns) or
 * `"run"`.
 * @param {string | null | undefined} changed
 * @param {boolean} force
 * @returns {string}
 */
export function sessionEnter(changed, force) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        var len0 = WASM_VECTOR_LEN;
        wasm.sessionEnter(retptr, ptr0, len0, force);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export_4(deferred2_0, deferred2_1, 1);
    }
}

/**
 * The pass ended (`finished` when it didn't throw): the rerun it owes as `{ force, exact, changed }`, or `null`.
 * @param {boolean} finished
 * @returns {any}
 */
export function sessionExit(finished) {
    const ret = wasm.sessionExit(finished);
    return takeObject(ret);
}

/**
 * The pass's state as the host caches it: `{ mode, dirty, forceExact, gen, rebuilding, topoDirty, passActive }`.
 * @returns {object}
 */
export function sessionSnapshot() {
    const ret = wasm.sessionSnapshot();
    return takeObject(ret);
}

/**
 * A fresh instance (after a trap) takes back the state the host last saw; the coalesced rerun is gone.
 * @param {object} snapshot
 */
export function sessionRestore(snapshot) {
    wasm.sessionRestore(addHeapObject(snapshot));
}

/**
 * `false` when `mode` is the mode already.
 * @param {string} mode
 * @returns {boolean}
 */
export function sessionSetMode(mode) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sessionSetMode(ptr0, len0);
    return ret !== 0;
}

/**
 * Sets (`true`) or clears the dirty flag; `true` on a transition.
 * @param {boolean} dirty
 * @returns {boolean}
 */
export function sessionDirty(dirty) {
    const ret = wasm.sessionDirty(dirty);
    return ret !== 0;
}

/**
 * Opens (`true`) or closes a force-exact bracket.
 * @param {boolean} begin
 */
export function sessionForceExact(begin) {
    wasm.sessionForceExact(begin);
}

/**
 * A new recalc generation, which every volatile node rolls on.
 * @returns {number}
 */
export function sessionNextGeneration() {
    const ret = wasm.sessionNextGeneration();
    return ret;
}

/**
 * Opens (`true`) or closes a rebuild scope; closing answers whether none is open after it.
 * @param {boolean} begin
 * @returns {boolean}
 */
export function sessionRebuild(begin) {
    const ret = wasm.sessionRebuild(begin);
    return ret !== 0;
}

/**
 * `withGraphRebuild`'s scope: opening clears the topology flag; closing answers `[noneOpen, cableChanged]`.
 * @param {boolean} open
 * @returns {Array<any>}
 */
export function sessionRebuildScope(open) {
    const ret = wasm.sessionRebuildScope(open);
    return takeObject(ret);
}

/**
 * @param {string} _class
 * @returns {boolean}
 */
export function isLazyFrameNode(_class) {
    const ptr0 = passStringToWasm0(_class, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isLazyFrameNode(ptr0, len0);
    return ret !== 0;
}

/**
 * @param {string} _class
 * @returns {boolean}
 */
export function seesErrors(_class) {
    const ptr0 = passStringToWasm0(_class, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.seesErrors(ptr0, len0);
    return ret !== 0;
}

/**
 * Installs what the boundary asks the app for; every engine call that runs a node needs it.
 * @param {object} host
 */
export function setBoundaryHost(host) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.setBoundaryHost(retptr, addHeapObject(host));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {any} v
 * @returns {any}
 */
export function findCellError(v) {
    const ret = wasm.findCellError(addHeapObject(v));
    return takeObject(ret);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}
function __wbg_adapter_36(arg0, arg1, arg2) {
    wasm.__wbindgen_export_5(arg0, arg1, addHeapObject(arg2));
}

function __wbg_adapter_128(arg0, arg1, arg2, arg3) {
    wasm.__wbindgen_export_6(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

const GraphCoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(({ ptr, epoch }) => epoch === __wbg_epoch && wasm.__wbg_graphcore_free(ptr >>> 0, 1));
/**
 * One editor's graph and its dataflow engine.
 */
export class GraphCore {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GraphCoreFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_graphcore_free(ptr, 0);
    }
    /**
     * What a change to `id` reaches, its caches cleared; `undefined` without a node.
     * @param {string | null | undefined} id
     * @param {boolean} keep_caches
     * @returns {string[] | undefined}
     */
    invalidate(id, keep_caches) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_invalidate(retptr, this.__wbg_ptr, ptr0, len0, keep_caches);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getArrayJsValueFromWasm0(r0, r1).slice();
                wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Seeds `#CIRC!` on every loop member (with `message`, or the default one) and returns them.
     * @param {string | null} [message]
     * @returns {string[]}
     */
    seedLoops(message) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_seedLoops(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Attaches the engine here in the chain, registering the nodes already in the editor. A `raw` engine calls each
     * node's `data()` as it is; any other runs it through the input boundary.
     * @param {boolean} raw
     */
    useEngine(raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.graphcore_useEngine(retptr, this.__wbg_ptr, raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The model pass (`computeAll`): what `changed` reaches cleared (every cache without it), the loops seeded,
     * every node fetched. A `Map` of each node's outputs, `null` for one a reset cancelled.
     * @param {string | null} [changed]
     * @returns {Promise<any>}
     */
    computeAll(changed) {
        var ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_computeAll(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Marks every composite holding `id` (at any depth) as edited inside; the outermost one's id, or `undefined`
     * when no composite here holds it.
     * @param {string} id
     * @returns {string | undefined}
     */
    markNested(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_markNested(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1).slice();
                wasm.__wbindgen_export_4(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `false` when a `noderemove` pipe cancelled it.
     * @param {string} id
     * @returns {boolean}
     */
    removeNode(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_removeNode(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} handle
     * @returns {boolean}
     */
    removePipe(handle) {
        const ret = wasm.graphcore_removePipe(this.__wbg_ptr, handle);
        return ret !== 0;
    }
    /**
     * @param {string} id
     * @param {boolean} output
     * @param {string} key
     * @returns {boolean}
     */
    removePort(id, output, key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(key, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len1 = WASM_VECTOR_LEN;
            wasm.graphcore_removePort(retptr, this.__wbg_ptr, ptr0, len0, output, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} id
     * @param {boolean} output
     * @param {string} key
     * @param {string} ty
     * @returns {boolean}
     */
    retypePort(id, output, key, ty) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(key, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(ty, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len2 = WASM_VECTOR_LEN;
            wasm.graphcore_retypePort(retptr, this.__wbg_ptr, ptr0, len0, output, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The node's inputs, fetching every predecessor.
     * @param {string} id
     * @returns {Promise<any>}
     */
    fetchInputs(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_fetchInputs(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * @returns {string[]}
     */
    loopMembers() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.graphcore_loopMembers(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
     * @param {string[]} order
     * @returns {boolean}
     */
    reorderNodes(order) {
        const ptr0 = passArrayJsValueToWasm0(order, wasm.__wbindgen_export_2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_reorderNodes(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * `false` when a `connectioncreate` pipe cancelled it.
     * @param {any} object
     * @param {string} id
     * @param {string} source
     * @param {string} source_output
     * @param {string} target
     * @param {string} target_input
     * @returns {boolean}
     */
    addConnection(object, id, source, source_output, target, target_input) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(source, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(source_output, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(target, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(target_input, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len4 = WASM_VECTOR_LEN;
            wasm.graphcore_addConnection(retptr, this.__wbg_ptr, addHeapObject(object), ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string[]}
     */
    connectionIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.graphcore_connectionIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `false` when a `connectionremove` pipe cancelled it.
     * @param {string} id
     * @returns {boolean}
     */
    removeConnection(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_removeConnection(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} id
     * @returns {string[]}
     */
    downstreamClosure(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_downstreamClosure(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `cancelled` is the class of error a fetch cut short by a reset rejects with.
     * @param {Function} cancelled
     */
    constructor(cancelled) {
        const ret = wasm.graphcore_new(addHeapObject(cancelled));
        this.__wbg_ptr = ret >>> 0;
        GraphCoreFinalization.register(this, { ptr: this.__wbg_ptr, epoch: __wbg_epoch }, this);
        return this;
    }
    /**
     * `id` is a composite node here whose own editor's core is `inner`.
     * @param {string} id
     * @param {GraphCore} inner
     */
    nest(id, inner) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(inner, GraphCore);
        wasm.graphcore_nest(this.__wbg_ptr, ptr0, len0, inner.__wbg_ptr);
    }
    /**
     * The app's pass body ([[compute-pass]] § The pass body): `changed` retargeted to the composite holding it,
     * what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
     * (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order with `on_node(id,
     * outputs)` answering whether its outputs changed. The nodes to re-render, in order; `null` when a reset
     * cancelled the pass.
     * @param {string | null | undefined} changed
     * @param {string[] | null | undefined} render_only
     * @param {boolean} topology
     * @param {Function} on_node
     * @returns {Promise<any>}
     */
    pass(changed, render_only, topology, on_node) {
        var ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(render_only) ? 0 : passArrayJsValueToWasm0(render_only, wasm.__wbindgen_export_2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_pass(this.__wbg_ptr, ptr0, len0, ptr1, len1, topology, addHeapObject(on_node));
        return takeObject(ret);
    }
    /**
     * Gives the node `outputs` without running it, until something clears its cache.
     * @param {string} id
     * @param {any} outputs
     */
    seed(id, outputs) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_seed(this.__wbg_ptr, ptr0, len0, addHeapObject(outputs));
    }
    /**
     * Every cable, then every node; `false` when a `clear` pipe cancelled it.
     * @returns {boolean}
     */
    clear() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.graphcore_clear(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The node's outputs, from the cache when present.
     * @param {string} id
     * @returns {Promise<any>}
     */
    fetch(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_fetch(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * The node's ports on one side as `[key, type]` pairs, in order; `undefined` for a node not
     * here.
     * @param {string} id
     * @param {boolean} output
     * @returns {Array<any> | undefined}
     */
    ports(id, output) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_ports(this.__wbg_ptr, ptr0, len0, output);
        return takeObject(ret);
    }
    /**
     * Clears the node's cache and everything downstream through the outputs it computes;
     * without a node, every cache.
     * @param {string | null} [id]
     */
    reset(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_reset(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Clears the node's cache alone, cancelling a run in flight.
     * @param {string} id
     */
    forget(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_forget(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} id
     */
    unnest(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_unnest(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The node computed on `inputs` (one list per input key) as the engine computes it, without its cache.
     * @param {string} id
     * @param {any} inputs
     * @returns {Promise<any>}
     */
    compute(id, inputs) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_compute(this.__wbg_ptr, ptr0, len0, addHeapObject(inputs));
        return takeObject(ret);
    }
    /**
     * `false` when a `nodecreate` pipe cancelled it.
     * @param {string} id
     * @param {object} object
     * @param {string[]} input_keys
     * @param {string[]} input_types
     * @param {string[]} output_keys
     * @param {string[]} output_types
     * @returns {boolean}
     */
    addNode(id, object, input_keys, input_types, output_keys, output_types) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayJsValueToWasm0(input_keys, wasm.__wbindgen_export_2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArrayJsValueToWasm0(input_types, wasm.__wbindgen_export_2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArrayJsValueToWasm0(output_keys, wasm.__wbindgen_export_2);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passArrayJsValueToWasm0(output_types, wasm.__wbindgen_export_2);
            const len4 = WASM_VECTOR_LEN;
            wasm.graphcore_addNode(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(object), ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Adds `pipe(type, data)` after every pipe already here: it answers truthy to go on, falsy to
     * stop the chain (cancelling the change a present-tense signal announces), and what it
     * throws stops the chain and fails the edit. Returns the handle `removePipe` takes.
     * @param {Function} pipe
     * @returns {number}
     */
    addPipe(pipe) {
        const ret = wasm.graphcore_addPipe(this.__wbg_ptr, addHeapObject(pipe));
        return ret >>> 0;
    }
    /**
     * @param {string} id
     * @param {boolean} output
     * @param {string} key
     * @param {string} ty
     */
    addPort(id, output, key, ty) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(key, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(ty, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
            const len2 = WASM_VECTOR_LEN;
            wasm.graphcore_addPort(retptr, this.__wbg_ptr, ptr0, len0, output, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string[]}
     */
    nodeIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.graphcore_nodeIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export_4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
     * a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
     * @param {Function | null | undefined} on_node
     * @param {boolean} stop_on_cancel
     * @returns {Promise<any>}
     */
    fetchAll(on_node, stop_on_cancel) {
        const ret = wasm.graphcore_fetchAll(this.__wbg_ptr, isLikeNone(on_node) ? 0 : addHeapObject(on_node), stop_on_cancel);
        return takeObject(ret);
    }
    /**
     * @param {string} id
     * @returns {boolean}
     */
    isCached(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_isCached(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_all_d5bf227e8f68795d = function(arg0) {
        const ret = Promise.all(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_apply_eb9e9b97497f91e4 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.apply(getObject(arg0), getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_assign_3627b8559449930a = function(arg0, arg1) {
        const ret = Object.assign(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_call_672a4d21634d4a24 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_7cccdd69e0791ae2 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_833bed5770ea2041 = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_construct_b91ff0e53b60c0c3 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.construct(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_from_2a5d3e218e67aa85 = function(arg0) {
        const ret = Array.from(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_getRandomValues_1c61fac11405ffdc = function() { return handleError(function (arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
    }, arguments) };
    imports.wbg.__wbg_get_67b2ba62fc30de12 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_get_b9b93047fe3cf45b = function(arg0, arg1) {
        const ret = getObject(arg0)[arg1 >>> 0];
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_has_a5ea9117f258a0ec = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.has(getObject(arg0), getObject(arg1));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_instanceof_Error_4d54113b22d20306 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof Error;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Object_7f2dcef8f78644a4 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof Object;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Promise_935168b8f4b49db3 = function(arg0) {
        let result;
        try {
            result = getObject(arg0) instanceof Promise;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_a1eab7e0d067391b = function(arg0) {
        const ret = Array.isArray(getObject(arg0));
        return ret;
    };
    imports.wbg.__wbg_isPrototypeOf_372fa1d8cba01591 = function(arg0, arg1) {
        const ret = getObject(arg0).isPrototypeOf(getObject(arg1));
        return ret;
    };
    imports.wbg.__wbg_keys_5c77a08ddc2fb8a6 = function(arg0) {
        const ret = Object.keys(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_length_e2d2a49132c1b256 = function(arg0) {
        const ret = getObject(arg0).length;
        return ret;
    };
    imports.wbg.__wbg_message_97a2af9b89d693a3 = function(arg0) {
        const ret = getObject(arg0).message;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_name_0b327d569f00ebee = function(arg0) {
        const ret = getObject(arg0).name;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_23a2665fac83c611 = function(arg0, arg1) {
        try {
            var state0 = {a: arg0, b: arg1};
            var cb0 = (arg0, arg1) => {
                const a = state0.a;
                state0.a = 0;
                try {
                    return __wbg_adapter_128(a, state0.b, arg0, arg1);
                } finally {
                    state0.a = a;
                }
            };
            const ret = new Promise(cb0);
            return addHeapObject(ret);
        } finally {
            state0.a = state0.b = 0;
        }
    };
    imports.wbg.__wbg_new_405e22f390576ce2 = function() {
        const ret = new Object();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_5e0be73521bc8c17 = function() {
        const ret = new Map();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_78feb108b6472713 = function() {
        const ret = new Array();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_b08a00743b8ae2f3 = function(arg0, arg1) {
        const ret = new TypeError(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_c68d7209be747379 = function(arg0, arg1) {
        const ret = new Error(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newnoargs_105ed471475aaf50 = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newwithlength_c4c419ef0bc8a1f8 = function(arg0) {
        const ret = new Array(arg0 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_of_2eaf5a02d443ef03 = function(arg0) {
        const ret = Array.of(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_of_4a05197bfc89556f = function(arg0, arg1, arg2) {
        const ret = Array.of(getObject(arg0), getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_of_66b3ee656cbd962b = function(arg0, arg1) {
        const ret = Array.of(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_push_737cfc8c1432c2c6 = function(arg0, arg1) {
        const ret = getObject(arg0).push(getObject(arg1));
        return ret;
    };
    imports.wbg.__wbg_queueMicrotask_97d92b4fcc8a61c5 = function(arg0) {
        queueMicrotask(getObject(arg0));
    };
    imports.wbg.__wbg_queueMicrotask_d3219def82552485 = function(arg0) {
        const ret = getObject(arg0).queueMicrotask;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_resolve_4851785c9c5f573d = function(arg0) {
        const ret = Promise.resolve(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_37837023f3d740e8 = function(arg0, arg1, arg2) {
        getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
    };
    imports.wbg.__wbg_set_8fc6bf8a5b1071d1 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_bb8cecf6a62b9f46 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_slice_a18aced6f26168b6 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).slice(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_37c5d418e4bf5819 = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_then_44b73946d2fb3e7d = function(arg0, arg1) {
        const ret = getObject(arg0).then(getObject(arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_then_48b406749878a531 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_boolean_get = function(arg0) {
        const v = getObject(arg0);
        const ret = typeof(v) === 'boolean' ? (v ? 1 : 0) : 2;
        return ret;
    };
    imports.wbg.__wbindgen_cb_drop = function(arg0) {
        const obj = takeObject(arg0).original;
        if (obj.cnt-- == 1) {
            obj.a = 0;
            return true;
        }
        const ret = false;
        return ret;
    };
    imports.wbg.__wbindgen_closure_wrapper466 = function(arg0, arg1, arg2) {
        const ret = makeMutClosure(arg0, arg1, 112, __wbg_adapter_36);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_debug_string = function(arg0, arg1) {
        const ret = debugString(getObject(arg1));
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_is_falsy = function(arg0) {
        const ret = !getObject(arg0);
        return ret;
    };
    imports.wbg.__wbindgen_is_function = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'function';
        return ret;
    };
    imports.wbg.__wbindgen_is_null = function(arg0) {
        const ret = getObject(arg0) === null;
        return ret;
    };
    imports.wbg.__wbindgen_is_object = function(arg0) {
        const val = getObject(arg0);
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbindgen_is_string = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'string';
        return ret;
    };
    imports.wbg.__wbindgen_is_undefined = function(arg0) {
        const ret = getObject(arg0) === undefined;
        return ret;
    };
    imports.wbg.__wbindgen_jsval_eq = function(arg0, arg1) {
        const ret = getObject(arg0) === getObject(arg1);
        return ret;
    };
    imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
        const obj = getObject(arg1);
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbindgen_number_new = function(arg0) {
        const ret = arg0;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_clone_ref = function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
        takeObject(arg0);
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = getObject(arg1);
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export_2, wasm.__wbindgen_export_3);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;



    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('solenoid_graph_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;

export function __wbg_reset() {
    const module = __wbg_init.__wbindgen_wasm_module;
    wasm = undefined;
    __wbg_epoch++;
    heap.length = 128;
    heap.fill(undefined);
    heap.push(undefined, null, true, false);
    heap_next = heap.length;
    return module;
}
