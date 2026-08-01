export { HANDLER_CATALOG, getHandlerMeta } from "./handlers";
export {
  ensureTransformRules,
  listTransformRules,
  getTransformRule,
} from "./rules";
export {
  TransformError,
  listAvailableTransforms,
  previewTransform,
  executeTransform,
  type TransformPreview,
  type CoverageLine,
} from "./engine";
export {
  HANDLER_KEYS,
  DOCUMENT_KINDS,
  transformRuleCreateSchema,
  transformRuleUpdateSchema,
  transformPreviewSchema,
  transformExecuteSchema,
  type HandlerKey,
} from "./schemas";
