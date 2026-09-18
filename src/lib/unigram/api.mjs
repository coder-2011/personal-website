import model from '../../data/t5-unigram.json' with { type:'json' };
import { createUnigram } from './engine.mjs';
import { createTraceHandler } from '../tokenizer-api.mjs';

const { trace } = createUnigram(model);
export const handleUnigramRequest = createTraceHandler(trace);
