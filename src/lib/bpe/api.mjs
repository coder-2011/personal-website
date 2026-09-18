import model from '../../data/gpt2.json' with { type: 'json' };
import { createBPE } from './engine.mjs';

import { createTraceHandler } from '../tokenizer-api.mjs';

const { trace, visible } = createBPE(model);

export const handleBpeRequest = createTraceHandler(text => {
  const frames = trace(text).map(frame => ({
    ...frame,
    tokens: frame.tokens.map(token => ({ ...token, text: visible(token.text) })),
    candidate: frame.candidate && {
      ...frame.candidate,
      left: visible(frame.candidate.left),
      right: visible(frame.candidate.right),
      merged: visible(frame.candidate.left + frame.candidate.right),
      choices: frame.candidate.choices.slice(0, 6).map(choice => ({
        ...choice, left: visible(choice.left), right: visible(choice.right),
      })),
    },
  }));
  return { model: 'gpt2', version: 1, frames };
});
