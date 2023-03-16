import * as v from '@badrap/valita';
import {jsonSchema} from './json.js';

const putOpSchema = v.object({
  op: v.literal('put'),
  key: v.string(),
  value: jsonSchema,
});

const delOpSchema = v.object({
  op: v.literal('del'),
  key: v.string(),
});

const patchOpSchema = v.union(putOpSchema, delOpSchema);

export const patchSchema = v.array(patchOpSchema);
export type PutOp = v.Infer<typeof putOpSchema>;
export type DelOp = v.Infer<typeof delOpSchema>;
export type PatchOp = v.Infer<typeof patchOpSchema>;
export type Patch = v.Infer<typeof patchSchema>;
