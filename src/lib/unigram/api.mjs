import { createUnigram } from './engine.mjs';
import { createTraceHandler } from '../tokenizer-api.mjs';

let engine;
export const handleUnigramRequest = createTraceHandler(async text => {
  engine ??= import('../../data/t5-unigram.json', { with: { type: 'json' } }).then(({default:model}) => createUnigram(model));
  return (await engine).trace(text);
});
