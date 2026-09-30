import { TEXT_TRANSFORM_OP_META, type TextTransformOp, type TextTransformNode as TextTransformNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const TextTransformComponent = makeOpNodeComponent<TextTransformOp, TextTransformNodeType>(TEXT_TRANSFORM_OP_META, (n) => n.cachedText);
