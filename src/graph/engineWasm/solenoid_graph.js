/* @ts-self-types="./solenoid_graph.d.ts" */

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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
            try {
                ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passStringToWasm0(source_output, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passStringToWasm0(target, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len3 = WASM_VECTOR_LEN;
                ptr4 = passStringToWasm0(target_input, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len4 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr4) { wasm.__wbindgen_export3(ptr4, len4 * 1, 1); }
                if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 1, 1); }
                if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.graphcore_addConnection(retptr, this.__wbg_ptr, object, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
            try {
                ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArrayJsValueToWasm0(input_keys, wasm.__wbindgen_export);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passArrayJsValueToWasm0(input_types, wasm.__wbindgen_export);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passArrayJsValueToWasm0(output_keys, wasm.__wbindgen_export);
                len3 = WASM_VECTOR_LEN;
                ptr4 = passArrayJsValueToWasm0(output_types, wasm.__wbindgen_export);
                len4 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr4) { wasm.__wbindgen_export6(ptr4, len4); wasm.__wbindgen_export3(ptr4, len4 * 4, 4); }
                if (ptr3) { wasm.__wbindgen_export6(ptr3, len3); wasm.__wbindgen_export3(ptr3, len3 * 4, 4); }
                if (ptr2) { wasm.__wbindgen_export6(ptr2, len2); wasm.__wbindgen_export3(ptr2, len2 * 4, 4); }
                if (ptr1) { wasm.__wbindgen_export6(ptr1, len1); wasm.__wbindgen_export3(ptr1, len1 * 4, 4); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.graphcore_addNode(retptr, this.__wbg_ptr, ptr0, len0, object, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
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
        const ret = wasm.graphcore_addPipe(this.__wbg_ptr, pipe);
        return ret >>> 0;
    }
    /**
     * The run a cable belongs to (`conduit.rs`), as `{ connIds, origin: [node, output], terminals: [[node, input]],
     * conduits }`; `undefined` for a cable not here.
     * Every port's format annotation and every node's value origin over this graph, from each node's facts
     * (`annotationFacts.ts`): `annotate::resolve_all`'s answer as JSON.
     * @param {string} facts
     * @returns {string}
     */
    annotate(facts) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(facts, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_annotate(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Every cable, then every node; `false` when a `clear` pipe cancelled it.
     * @returns {boolean}
     */
    clear() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.graphcore_clear(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return r0 !== 0;
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
        var ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_computeAll(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * The node computed on `inputs` (one list per input key) as the engine computes it, without its cache.
     * @param {string} id
     * @param {any} inputs
     * @returns {Promise<any>}
     */
    compute(id, inputs) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_compute(this.__wbg_ptr, ptr0, len0, inputs);
        return ret;
    }
    /**
     * @param {string} cable_id
     * @returns {string | undefined}
     */
    conduitPath(cable_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(cable_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_conduitPath(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string[]}
     */
    connectionIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.graphcore_connectionIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v1;
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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_downstreamClosure(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v2;
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
        const val1 = +stop_on_cancel;
        const ret = wasm.graphcore_fetchAll(this.__wbg_ptr, isLikeNone(on_node) ? 0 : addToExternrefTable0(on_node), val1);
        return ret;
    }
    /**
     * The node's inputs, fetching every predecessor.
     * @param {string} id
     * @returns {Promise<any>}
     */
    fetchInputs(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_fetchInputs(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * The node's outputs, from the cache when present.
     * @param {string} id
     * @returns {Promise<any>}
     */
    fetch(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_fetch(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Clears the node's cache alone, cancelling a run in flight.
     * @param {string} id
     */
    forget(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_forget(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * What a change to `id` reaches, its caches cleared; `undefined` without a node.
     * @param {string | null | undefined} id
     * @param {boolean} keep_caches
     * @returns {string[] | undefined}
     */
    invalidate(id, keep_caches) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const val2 = +keep_caches;
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_invalidate(retptr, this.__wbg_ptr, ptr0, len0, val2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v3;
            if (r0 !== 0) {
                v3 = getArrayJsValueFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 4, 4);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} id
     * @returns {boolean}
     */
    isCached(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_isCached(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * The output `key` of node `id` as the last pass landed it; `undefined` before one did.
     * @param {string} id
     * @param {string} key
     * @returns {any}
     */
    landed(id, key) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.graphcore_landed(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * @returns {string[]}
     */
    loopMembers() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.graphcore_loopMembers(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Marks every composite holding `id` (at any depth) as edited inside; the outermost one's id, or `undefined`
     * when no composite here holds it.
     * @param {string} id
     * @returns {string | undefined}
     */
    markNested(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_markNested(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export3(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The node changed in place (a field, a literal, a label), here or inside a composite here: its call is read
     * afresh on its next compute. `false` when no editor here holds it.
     * @param {string} id
     * @returns {boolean}
     */
    named(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_named(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * `id` is a composite node here whose own editor's core is `inner`.
     * @param {string} id
     * @param {GraphCore} inner
     */
    nest(id, inner) {
        _assertClass(inner, GraphCore);
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_nest(this.__wbg_ptr, ptr0, len0, inner.__wbg_ptr);
    }
    /**
     * `cancelled` is the class of error a fetch cut short by a reset rejects with; `adopt(node, field)` makes the
     * object read a field the core holds for it (`GraphEditor.adopt`).
     * @param {Function} cancelled
     * @param {Function} adopt
     */
    constructor(cancelled, adopt) {
        const ret = wasm.graphcore_new(cancelled, adopt);
        this.__wbg_ptr = ret;
        GraphCoreFinalization.register(this, { ptr: this.__wbg_ptr, epoch: __wbg_epoch }, this);
        return this;
    }
    /**
     * @returns {string[]}
     */
    nodeIds() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.graphcore_nodeIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The app's pass body (compute-pass.md § The pass body): `changed` retargeted to the composite holding it,
     * what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
     * (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order and landed (its
     * outputs held for the cable readouts, the change test against what it landed before). The nodes to re-render, in
     * order; `null` when a reset cancelled the pass.
     * @param {string | null | undefined} changed
     * @param {string[] | null | undefined} render_only
     * @param {boolean} topology
     * @returns {Promise<any>}
     */
    pass(changed, render_only, topology) {
        const val3 = +topology;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = isLikeNone(render_only) ? 0 : passArrayJsValueToWasm0(render_only, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export6(ptr1, len1); wasm.__wbindgen_export3(ptr1, len1 * 4, 4); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.graphcore_pass(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
        return ret;
    }
    /**
     * The node's ports on one side as `[key, type]` pairs, in order; `undefined` for a node not
     * here.
     * @param {string} id
     * @param {boolean} output
     * @returns {Array<any> | undefined}
     */
    ports(id, output) {
        const val2 = +output;
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_ports(this.__wbg_ptr, ptr0, len0, val2);
        return ret;
    }
    /**
     * The Format Controller reconcile over this graph, from each node's facts (`fcFacts.ts`): `fc::reconcile`'s
     * answer as JSON.
     * @param {string} facts
     * @returns {string}
     */
    reconcileFcs(facts) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(facts, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_reconcileFcs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Every node's fields the core held go back to its object, so the editor can free this core and build another
     * from its objects when it's used again (`GraphEditor.dispose`).
     */
    release() {
        wasm.graphcore_release(this.__wbg_ptr);
    }
    /**
     * `false` when a `connectionremove` pipe cancelled it.
     * @param {string} id
     * @returns {boolean}
     */
    removeConnection(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_removeConnection(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
            }
            return r0 !== 0;
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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_removeNode(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeFromExternrefTable0(r1);
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
     * Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
     * @param {string[]} order
     * @returns {boolean}
     */
    reorderNodes(order) {
        const ptr0 = passArrayJsValueToWasm0(order, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphcore_reorderNodes(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Clears the node's cache and everything downstream through the outputs it computes;
     * without a node, every cache.
     * @param {string | null} [id]
     */
    reset(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_reset(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.graphcore_seedLoops(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Gives the node `outputs` without running it, until something clears its cache.
     * @param {string} id
     * @param {any} outputs
     */
    seed(id, outputs) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_seed(this.__wbg_ptr, ptr0, len0, outputs);
    }
    /**
     * Gives the node exactly these ports, in order: a node's socket changes reach the core as one call.
     * @param {string} id
     * @param {string[]} input_keys
     * @param {string[]} input_types
     * @param {string[]} output_keys
     * @param {string[]} output_types
     */
    setPorts(id, input_keys, input_types, output_keys, output_types) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
            try {
                ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passArrayJsValueToWasm0(input_keys, wasm.__wbindgen_export);
                len1 = WASM_VECTOR_LEN;
                ptr2 = passArrayJsValueToWasm0(input_types, wasm.__wbindgen_export);
                len2 = WASM_VECTOR_LEN;
                ptr3 = passArrayJsValueToWasm0(output_keys, wasm.__wbindgen_export);
                len3 = WASM_VECTOR_LEN;
                ptr4 = passArrayJsValueToWasm0(output_types, wasm.__wbindgen_export);
                len4 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr4) { wasm.__wbindgen_export6(ptr4, len4); wasm.__wbindgen_export3(ptr4, len4 * 4, 4); }
                if (ptr3) { wasm.__wbindgen_export6(ptr3, len3); wasm.__wbindgen_export3(ptr3, len3 * 4, 4); }
                if (ptr2) { wasm.__wbindgen_export6(ptr2, len2); wasm.__wbindgen_export3(ptr2, len2 * 4, 4); }
                if (ptr1) { wasm.__wbindgen_export6(ptr1, len1); wasm.__wbindgen_export3(ptr1, len1 * 4, 4); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.graphcore_setPorts(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * JavaScript wrote a field the core holds for a direct card; `false` where it holds none for it.
     * @param {string} id
     * @param {string} field
     * @param {any} value
     * @returns {boolean}
     */
    setShown(id, field, value) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(field, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.graphcore_setShown(this.__wbg_ptr, ptr0, len0, ptr1, len1, value);
        return ret !== 0;
    }
    /**
     * The Type Settle over this editor (`settle.rs`): `facts` is each node's, as `settleFacts.ts` writes them, and the
     * order and cables are the graph's. Answers `{ changes: [[id, "in" | "out", key, type]], conduitChanged, adopted }`.
     * @param {string} facts
     * @returns {string}
     */
    settleTypes(facts) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passStringToWasm0(facts, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.graphcore_settleTypes(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * A field the core holds for a direct card (`cachedResult` and the rest); `undefined` where it holds none.
     * @param {string} id
     * @param {string} field
     * @returns {any}
     */
    shown(id, field) {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(field, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.graphcore_shown(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * The output an output's value comes from, through every Conduit lane: `[node, output]` (`conduit.rs`).
     * @param {string} id
     * @param {string} key
     * @returns {string[]}
     */
    typedSource(id, key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
                throw e;
            }
            wasm.graphcore_typedSource(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 4, 4);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} id
     */
    unnest(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.graphcore_unnest(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Attaches the engine here in the chain, registering the nodes already in the editor. A `raw` engine calls each
     * node's `data()` as it is; any other runs it through the input boundary.
     * @param {boolean} raw
     */
    useEngine(raw) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            wasm.graphcore_useEngine(retptr, this.__wbg_ptr, raw);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) GraphCore.prototype[Symbol.dispose] = GraphCore.prototype.free;

/**
 * On, every full clear checks that no direct card's call changed with its node unnamed (`unnamedEdits`).
 * @param {boolean} on
 */
export function auditNamedEdits(on) {
    wasm.auditNamedEdits(on);
}

/**
 * The image a Record cell's text shows, if any ([[C103]] untrustedContentSeams).
 * @param {string} text
 * @returns {string | undefined}
 */
export function card_image_src(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.card_image_src(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Whether a card cell's text is a hex colour, as the Cards view draws it.
 * @param {string} text
 * @returns {boolean}
 */
export function card_is_hex_color(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.card_is_hex_color(ptr0, len0);
    return ret !== 0;
}

/**
 * The address a card cell's text links to, if any.
 * @param {string} text
 * @returns {string | undefined}
 */
export function card_link_href(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.card_link_href(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Holds a big input of `engine_node`'s next call, a frame or a list as buffers (`nodes::columnar`); its id, which the
 * call names as `{"__staged": id}`.
 * @param {string} kind
 * @param {string | null | undefined} schema
 * @param {Uint8Array | number[]} tags
 * @param {Float64Array | number[]} nums
 * @param {string} strs
 * @param {Uint32Array | number[]} lens
 * @returns {number}
 */
export function card_stage(kind, schema, tags, nums, strs, lens) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
        try {
            ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = isLikeNone(schema) ? 0 : passStringToWasm0(schema, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArray8ToWasm0(tags, wasm.__wbindgen_export);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passArrayF64ToWasm0(nums, wasm.__wbindgen_export);
            len3 = WASM_VECTOR_LEN;
            ptr4 = passStringToWasm0(strs, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len4 = WASM_VECTOR_LEN;
            ptr5 = passArray32ToWasm0(lens, wasm.__wbindgen_export);
            len5 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr5) { wasm.__wbindgen_export3(ptr5, len5 * 4, 4); }
            if (ptr4) { wasm.__wbindgen_export3(ptr4, len4 * 1, 1); }
            if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 8, 8); }
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.card_stage(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeFromExternrefTable0(r1);
        }
        return r0 >>> 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Stages the answer `engine_node`'s reply named `{"staged": id}` for the `take_*` calls; its kind and schema as JSON
 * (`{"kind", "schema"}`), or null where it was taken already.
 * @param {number} id
 * @returns {string | undefined}
 */
export function card_unstage(id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.card_unstage(retptr, id);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v1;
        if (r0 !== 0) {
            v1 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export3(r0, r1 * 1, 1);
        }
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
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
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.computeNode(retptr, node, inputs, isLikeNone(data) ? 0 : addToExternrefTable0(data));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeFromExternrefTable0(r1);
        }
        return takeFromExternrefTable0(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The classes the engine calls in Rust (`nodes::DIRECT`), for `directBodies.test.ts`.
 * @returns {string[]}
 */
export function directBodies() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.directBodies(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The "Decimal places" and "Scientific from" settings every unformatted number shows by; the app sets them on load
 * and on each change.
 * @param {number | null} [number_decimals]
 * @param {string | null} [sci_above]
 */
export function display_settings(number_decimals, sci_above) {
    const val2 = +(isLikeNone(number_decimals) ? 0 : number_decimals);
    var ptr0 = isLikeNone(sci_above) ? 0 : passStringToWasm0(sci_above, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len0 = WASM_VECTOR_LEN;
    wasm.display_settings(!isLikeNone(number_decimals), val2, ptr0, len0);
}

/**
 * Stages `csvToFrame`'s typed columns for the `take_*` calls and answers their schema (`csv::frame_columnar`).
 * @param {string} text
 * @returns {string}
 */
export function engine_csv_frame(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_csv_frame(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Stages `parseCsvRows`'s fields for the `take_*` calls (`csv::rows_columnar`) and answers how many rows they make.
 * @param {string} text
 * @param {boolean} detect
 * @param {boolean} keep_blank
 * @returns {string}
 */
export function engine_csv_rows(text, detect, keep_blank) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val2 = +detect;
        const val3 = +keep_blank;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_csv_rows(retptr, ptr0, len0, val2, val3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Stages `inferColumn`'s reading of each column of a frame's cells for the `take_*` calls and answers its schema
 * (`nodes::infer_cells`). A text column comes back empty: its cells are the trimmed text the caller sent. The schema
 * is written as text, since a table of thousands of short columns spends more on building JSON values than on
 * reading its cells.
 * @param {string} schema
 * @param {Uint8Array | number[]} tags
 * @param {Float64Array | number[]} nums
 * @param {string} strs
 * @param {Uint32Array | number[]} lens
 * @returns {string}
 */
export function engine_infer_bin(schema, tags, nums, strs, lens) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
        try {
            ptr0 = passStringToWasm0(schema, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(tags, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArrayF64ToWasm0(nums, wasm.__wbindgen_export);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passStringToWasm0(strs, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len3 = WASM_VECTOR_LEN;
            ptr4 = passArray32ToWasm0(lens, wasm.__wbindgen_export);
            len4 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr4) { wasm.__wbindgen_export3(ptr4, len4 * 4, 4); }
            if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 1, 1); }
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 8, 8); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.engine_infer_bin(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred6_0 = r0;
        deferred6_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred6_0, deferred6_1, 1);
    }
}

/**
 * `{"ok": result}` or `{"err": {"__solError", code, message}}`, as JSON text.
 * @param {string} command
 * @param {string} args
 * @returns {string}
 */
export function engine_invoke(command, args) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(command, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(args, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.engine_invoke(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Stages a frame's cells for the `take_*` calls and answers its schema: every column, or the one
 * `column` names (`get_column`; `null` when none), each cut to `limit` cells when it's set.
 * @param {string} handle
 * @param {string | null} [column]
 * @param {number | null} [limit]
 * @returns {string}
 */
export function engine_read_bin(handle, column, limit) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val3 = +(isLikeNone(limit) ? Number.MAX_SAFE_INTEGER : (limit) >>> 0);
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(handle, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = isLikeNone(column) ? 0 : passStringToWasm0(column, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.engine_read_bin(retptr, ptr0, len0, ptr1, len1, val3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}

/**
 * @param {string} schema
 * @param {Uint8Array | number[]} tags
 * @param {Float64Array | number[]} nums
 * @param {string} strs
 * @param {Uint32Array | number[]} lens
 * @returns {string}
 */
export function engine_source_bin(schema, tags, nums, strs, lens) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4;
        try {
            ptr0 = passStringToWasm0(schema, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray8ToWasm0(tags, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArrayF64ToWasm0(nums, wasm.__wbindgen_export);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passStringToWasm0(strs, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len3 = WASM_VECTOR_LEN;
            ptr4 = passArray32ToWasm0(lens, wasm.__wbindgen_export);
            len4 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr4) { wasm.__wbindgen_export3(ptr4, len4 * 4, 4); }
            if (ptr3) { wasm.__wbindgen_export3(ptr3, len3 * 1, 1); }
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 8, 8); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.engine_source_bin(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred6_0 = r0;
        deferred6_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred6_0, deferred6_1, 1);
    }
}

/**
 * A unit id's unit (`unit_catalog::fc_unit_to_unit`) as `{ dim, scale, offset? }`, or `null` for an id that names none.
 * @param {string} id
 * @returns {string}
 */
export function fcUnit(id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.fcUnit(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {any} v
 * @returns {any}
 */
export function findCellError(v) {
    const ret = wasm.findCellError(v);
    return ret;
}

/**
 * A number as a format annotation (its JSON) shows it.
 * @param {number} n
 * @param {string} annotation
 * @returns {string}
 */
export function fmt_annotated(n, annotation) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val2 = +n;
        const ptr0 = passStringToWasm0(annotation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.fmt_annotated(retptr, val2, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * A date serial in a `YYYY-MM-DD`-style pattern.
 * @param {number} serial
 * @param {string} pattern
 * @returns {string}
 */
export function fmt_date(serial, pattern) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val2 = +serial;
        const ptr0 = passStringToWasm0(pattern, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.fmt_date(retptr, val2, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * A number nobody formatted, as the Format Controller's General style shows it.
 * @param {number} n
 * @returns {string}
 */
export function fmt_scalar(n) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.fmt_scalar(retptr, n);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A dimension's label (`unit_lists::format_dim`): `{ length: 1, time: -1 }` reads `m/s`; dimensionless is "".
 * @param {string} dim
 * @returns {string}
 */
export function formatDim(dim) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(dim, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.formatDim(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
 */
export function graphTrap() {
    wasm.graphTrap();
}

/**
 * @param {string} _class
 * @returns {boolean}
 */
export function isLazyFrameNode(_class) {
    const ptr0 = passStringToWasm0(_class, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isLazyFrameNode(ptr0, len0);
    return ret !== 0;
}

/**
 * The socket lattice as the tables the app reads (`lattice::tables_json`).
 * @returns {string}
 */
export function latticeTables() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.latticeTables(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The direct classes that hand on in TypeScript what the core can't hold (`nodes::OFF_CORE`).
 * @returns {string[]}
 */
export function offCoreBodies() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.offCoreBodies(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * A cell's predecessor text against the 1-based row names (`plan_files::parse_predecessors`).
 * @param {string} text
 * @param {string[]} names
 * @returns {string}
 */
export function parsePredecessors(text, names) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArrayJsValueToWasm0(names, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export6(ptr1, len1); wasm.__wbindgen_export3(ptr1, len1 * 4, 4); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.parsePredecessors(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * A plan file read (`plan_files::read_plan_file`): `format` is `mspdi`, `gan` or `xer`, or "" to tell by content.
 * @param {string} text
 * @param {string} format
 * @returns {string}
 */
export function readPlanFile(text, format) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(format, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.readPlanFile(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Text as a number: plain decimal or scientific, or thousands grouped by commas; NaN otherwise.
 * @param {string} text
 * @returns {number}
 */
export function read_decimal(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.read_decimal(ptr0, len0);
    return ret;
}

/**
 * Text as a logical: 1 for TRUE, 0 for FALSE, NaN when it doesn't read as one, and `undefined` for blank.
 * @param {string} text
 * @returns {number | undefined}
 */
export function read_logical(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.read_logical(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r2 = getDataViewMemory0().getFloat64(retptr + 8 * 1, true);
        return r0 === 0 ? undefined : r2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Each point's Conditional Regions key, by the cuts its card shows, one per line.
 * @param {string} cuts
 * @param {Float64Array | number[]} xs
 * @param {Float64Array | number[]} ys
 * @returns {string}
 */
export function region_keys(cuts, xs, ys) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(cuts, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArrayF64ToWasm0(xs, wasm.__wbindgen_export);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passArrayF64ToWasm0(ys, wasm.__wbindgen_export);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 8, 8); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 8, 8); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.region_keys(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}

/**
 * @param {string} _class
 * @returns {boolean}
 */
export function seesErrors(_class) {
    const ptr0 = passStringToWasm0(_class, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.seesErrors(ptr0, len0);
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
 * A request for a pass: `"gated"` (manual mode marked the graph dirty), `"queued"` (a pass in flight reruns) or
 * `"run"`.
 * @param {string | null | undefined} changed
 * @param {boolean} force
 * @returns {string}
 */
export function sessionEnter(changed, force) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val2 = +force;
        var ptr0 = isLikeNone(changed) ? 0 : passStringToWasm0(changed, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        wasm.sessionEnter(retptr, ptr0, len0, val2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The pass ended (`finished` when it didn't throw): the rerun it owes as `{ force, exact, changed }`, or `null`.
 * @param {boolean} finished
 * @returns {any}
 */
export function sessionExit(finished) {
    const ret = wasm.sessionExit(finished);
    return ret;
}

/**
 * Opens (`true`) or closes a force-exact bracket.
 * @param {boolean} begin
 */
export function sessionForceExact(begin) {
    wasm.sessionForceExact(begin);
}

export function sessionMarkTopoDirty() {
    wasm.sessionMarkTopoDirty();
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
    return ret;
}

/**
 * A fresh instance (after a trap) takes back the state the host last saw; the coalesced rerun is gone.
 * @param {object} snapshot
 */
export function sessionRestore(snapshot) {
    wasm.sessionRestore(snapshot);
}

/**
 * `false` when `mode` is the mode already.
 * @param {string} mode
 * @returns {boolean}
 */
export function sessionSetMode(mode) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sessionSetMode(ptr0, len0);
    return ret !== 0;
}

/**
 * The pass's state as the host caches it: `{ mode, dirty, forceExact, gen, rebuilding, topoDirty, passActive }`.
 * @returns {object}
 */
export function sessionSnapshot() {
    const ret = wasm.sessionSnapshot();
    return ret;
}

/**
 * Installs what the boundary asks the app for; every engine call that runs a node needs it.
 * @param {object} host
 */
export function setBoundaryHost(host) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.setBoundaryHost(retptr, host);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeFromExternrefTable0(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Off, every card's `data()` runs in JavaScript, its body crossing through `nodeOnCore`: how the node recorder
 * (`FREEZE_NODES`) sees every call the suite makes.
 * @param {boolean} on
 */
export function setDirectCalls(on) {
    wasm.setDirectCalls(on);
}

/**
 * `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
 * it and instantiate the module afresh.
 * @param {Function} handler
 */
export function setPanicHandler(handler) {
    wasm.setPanicHandler(handler);
}

/**
 * @returns {Uint32Array}
 */
export function take_lens() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.take_lens(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @returns {Float64Array}
 */
export function take_nums() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.take_nums(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 8, 8);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @returns {string}
 */
export function take_strs() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.take_strs(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @returns {Uint8Array}
 */
export function take_tags() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.take_tags(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 1, 1);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * One node line read (`text_form::parse_line`), as `{ name, type, init, literals?, stringLiterals?, conns }`, or `!`
 * and why it can't be.
 * @param {string} line
 * @returns {string}
 */
export function textFormLine(line) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passStringToWasm0(line, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.textFormLine(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
    }
}

/**
 * The save a text holds, as JSON text, or `!` and why it can't be read (`text_form::read`).
 * @param {string} text
 * @param {number} version
 * @returns {string}
 */
export function textFormRead(text, version) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const val2 = +version;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.textFormRead(retptr, ptr0, len0, val2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred3_0, deferred3_1, 1);
    }
}

/**
 * A save's text form (`text_form::write`): the save, each node's name and the init field order, as JSON text.
 * @param {string} graph
 * @param {string} names
 * @param {string} order
 * @returns {string}
 */
export function textFormWrite(graph, names, order) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(graph, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(names, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(order, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_export3(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_export3(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_export3(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.textFormWrite(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}

/**
 * A node's or cable's id: sixteen lowercase hex digits from eight secure random bytes, Ruggine's `getUID`.
 * @returns {string}
 */
export function uid() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.uid(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred1_0, deferred1_1, 1);
    }
}

/**
 * The cards whose call changed with their node unnamed, as "Class label", since the last ask.
 * @returns {string[]}
 */
export function unnamedEdits() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.unnamedEdits(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_boolean_get_4f1baf9a00be3c74: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_f249a2a76caa9a55: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_falsy_d864b623500ae65d: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_38d7bfbe4cc84039: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_934b640d0889af78: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64((arg0 >>> 0) + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_09736879a3f67559: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_all_79a70a4b6aca6f9e: function(arg0) {
            const ret = Promise.all(arg0);
            return ret;
        },
        __wbg_apply_bfe2b07b146427e2: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.apply(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_apply_e2c1e00e05fc7519: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.apply(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_assign_6b6bb30388088072: function(arg0, arg1) {
            const ret = Object.assign(arg0, arg1);
            return ret;
        },
        __wbg_at_38ea368f4a6837c3: function(arg0) {
            const ret = new Date(arg0);
            return ret;
        },
        __wbg_call_40b008ba32f73991: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_construct_8670bb4c2b062969: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.construct(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_defineProperty_2a218dbe4af87b65: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.defineProperty(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_formatToParts_721511ee1a1bf976: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.formatToParts(arg1);
            return ret;
        }, arguments); },
        __wbg_format_d943dcddd5aa2a28: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg1.format(arg2);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_from_eac91875c8a5ffa4: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getDate_ac40d08c73b05aa5: function(arg0) {
            const ret = arg0.getDate();
            return ret;
        },
        __wbg_getFullYear_87bb42c70fd4aa1c: function(arg0) {
            const ret = arg0.getFullYear();
            return ret;
        },
        __wbg_getHours_ccc41cf089e8bfce: function(arg0) {
            const ret = arg0.getHours();
            return ret;
        },
        __wbg_getMilliseconds_b6ebbaa030274b56: function(arg0) {
            const ret = arg0.getMilliseconds();
            return ret;
        },
        __wbg_getMinutes_b58d52c5a9194db7: function(arg0) {
            const ret = arg0.getMinutes();
            return ret;
        },
        __wbg_getMonth_f2b9e8083ca01e62: function(arg0) {
            const ret = arg0.getMonth();
            return ret;
        },
        __wbg_getRandomValues_5d8c030b527203a6: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getSeconds_cb5f5ae425fa7107: function(arg0) {
            const ret = arg0.getSeconds();
            return ret;
        },
        __wbg_getTime_c10e7082420066a7: function(arg0) {
            const ret = arg0.getTime();
            return ret;
        },
        __wbg_get_2080c49015e35254: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_57b93e4469e51558: function(arg0, arg1) {
            const ret = arg0.get(arg1);
            return ret;
        },
        __wbg_get_d7176cfb76d71114: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_e6325ad374eff861: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_has_2c4d5cf25ec8c1cf: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_instanceof_Error_74e3cca0c4a69161: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Float64Array_4acace5b49aaf791: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Float64Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Object_97e16a01fd368661: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Object;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_59148c6049d0e3a0: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint32Array_ba721c3060d01f9a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint32Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_d7aeb0dcb3108fea: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_bcf1376d0d732d08: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isPrototypeOf_ad527b072b042d2d: function(arg0, arg1) {
            const ret = arg0.isPrototypeOf(arg1);
            return ret;
        },
        __wbg_keys_105f5c0857898f84: function(arg0) {
            const ret = Object.keys(arg0);
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_5a8bb8abe1e54e15: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b03a0fabb109b1e9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_c702d06d28b96b72: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_local_3a8ec9f7252917c3: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            const ret = new Date(arg0, arg1, arg2, arg3, arg4, arg5, arg6);
            return ret;
        },
        __wbg_message_43d8c8f1d543a349: function(arg0) {
            const ret = arg0.message;
            return ret;
        },
        __wbg_name_d1fa514fdca6a975: function(arg0) {
            const ret = arg0.name;
            return ret;
        },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_4416a2fe2fac9c65: function(arg0, arg1) {
            const ret = new TypeError(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_7075786089b89c5e: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_787b9fb330d55d78: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_f332e7bd769663f3: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Intl.DateTimeFormat(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_3512352010266e02: function(arg0, arg1) {
            const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_aaf85a9746711968: function(arg0, arg1) {
            const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_b8daf545a41c6aa0: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_e09da9dae6ee5935: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return __wasm_bindgen_func_elem_4552(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_a3dc62dea6e2e158: function(arg0) {
            const ret = new Array(arg0 >>> 0);
            return ret;
        },
        __wbg_of_027eb15371aac932: function(arg0) {
            const ret = Array.of(arg0);
            return ret;
        },
        __wbg_of_4cc373bef1f715a4: function(arg0, arg1, arg2) {
            const ret = Array.of(arg0, arg1, arg2);
            return ret;
        },
        __wbg_of_e7ea0fcd535c1444: function(arg0, arg1) {
            const ret = Array.of(arg0, arg1);
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_prototypesetcall_4aea6470234c8414: function(arg0, arg1, arg2) {
            Uint32Array.prototype.set.call(getArrayU32FromWasm0(arg0, arg1), arg2);
        },
        __wbg_prototypesetcall_a366c038a3918afa: function(arg0, arg1, arg2) {
            Float64Array.prototype.set.call(getArrayF64FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_1e8503a8a690f0a3: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_4a1a4d8dd332373b: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_random_df36b90cd78a7d54: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_reject_334b730b3c00849b: function(arg0) {
            const ret = Promise.reject(arg0);
            return ret;
        },
        __wbg_resolve_dbf78ab4942478b0: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_8282f7e0d2d01336: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_d2d33b52458e984a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_slice_85ae26e3542949c1: function(arg0, arg1, arg2) {
            const ret = arg0.slice(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_slice_984d22ab53865879: function(arg0, arg1) {
            const ret = arg1.slice();
            const ptr1 = passArrayJsValueToWasm0(ret, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_then_656f253a5dd7d8ea: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_e3f7f2d365708be8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 702, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_4535);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./solenoid_graph_bg.js": import0,
    };
}

function __wasm_bindgen_func_elem_4552(arg0, arg1, arg2, arg3) {
    wasm.__wasm_bindgen_func_elem_4552(arg0, arg1, arg2, arg3);
}

function __wasm_bindgen_func_elem_4535(arg0, arg1, arg2) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        wasm.__wasm_bindgen_func_elem_4535(retptr, arg0, arg1, arg2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeFromExternrefTable0(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

const GraphCoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(({ ptr, epoch }) => epoch === __wbg_epoch && wasm.__wbg_graphcore_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__wbindgen_export5();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.epoch === __wbg_epoch && wasm.__wbindgen_export7(state.a, state.b));

function debugString(val) {
    switch (typeof val) {
        // primitive types
        case 'number':
        case 'boolean':
        case 'undefined':
        return `${val}`;
        case 'string':
        return JSON.stringify(val);
        case 'bigint':
        return `${val}n`;
        case 'symbol':
        return val.description !== undefined
            ? `Symbol(${val.description})`
            : 'Symbol';
        case 'function':
        return typeof val.name === 'string' && val.name !== ''
            ? `Function(${val.name})`
            : 'Function';
        case 'object': {
            if (val === null) {
                return 'null';
            }
            // objects
            if (Array.isArray(val)) {
                return '[' + Array.from(val, debugString).join(', ') + ']';
            }
            // errors
            if (val instanceof Error) {
                return `${val.name}: ${val.message}\n${val.stack}`;
            }

            const toStringOutput = toString.call(val);
            // Test for built-in
            const className = /\[object ([^\]]+)\]/.exec(toStringOutput)?.[1];

            // Failed to match the standard '[object ClassName]'
            if (className === undefined) {
                return toStringOutput;
            }
            if (className === 'Object') {
                // we're a user defined class or Object
                // JSON.stringify avoids problems with cycles, and is generally much
                // easier than looping through ownProperties of `val`.
                try {
                    return 'Object(' + JSON.stringify(val) + ')';
                } catch (_) {
                    return 'Object';
                }
            }
            // TODO we could test for more things here, like `Set`s and `Map`s.
            return className;
        }
        // Per MDN: 'This list of values is exhaustive.'
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description
    }
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__wbindgen_export6(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_export4(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1, epoch: __wbg_epoch };
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
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_export7(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

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
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__wbindgen_export8(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
let __wbg_epoch = 0;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
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

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('solenoid_graph_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

export function __wbg_reset() {
    const module = wasmModule;
    wasm = undefined;
    wasmInstance = undefined;
    __wbg_init_promise = undefined;
    __wbg_epoch++;
    return module;
}
