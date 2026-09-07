import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckpoint } from '../lib/capabilities/codex-native/checkpoint.js';
const base = { version: 1, protocol: 'responses.compaction-trigger.v2', provider: 'codex-native-lab', model: 'gpt-5.4', identity: 'fixture-only' };
const opaque = { type: 'compaction', encrypted_content: 'fixture-opaque' };

test('native media cannot hide inside a structured text-only checkpoint', () => {
  for (const item of [
    { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
    { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
    { type: 'function_call_output', call_id: 'fixture', output: [{ type: 'input_audio', data: 'AA==' }] },
  ]) assert.throws(() => validateCheckpoint({ ...base, items: [item, opaque] }), /CHECKPOINT_MODALITY/);
  const argumentsText = '{"type":"image","headers":{"error":"business-data"}}';
  const result = validateCheckpoint({ ...base, items: [{ type: 'function_call', name: 'fixture', call_id: 'fixture', arguments: argumentsText }, opaque] });
  assert.equal(result.items[0].arguments, argumentsText);
});
