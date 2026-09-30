import { TEXT_SLICE_OP_META, type TextSliceOp, type TextSliceNode as TextSliceNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const TextSliceComponent = makeOpNodeComponent<TextSliceOp, TextSliceNodeType>(TEXT_SLICE_OP_META, (n) => n.cachedText);
