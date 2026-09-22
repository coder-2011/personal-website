import { createBPE } from './engine.mjs';

import { createTraceHandler } from '../tokenizer-api.mjs';

let engine;

export const handleBpeRequest = createTraceHandler(async text => {
  engine ??= import('../../data/gpt2.json', { with: { type: 'json' } }).then(({default:model}) => createBPE(model));
  const { trace, visible } = await engine;
  // Frames share most tokens. Decode each distinct byte string once per request.
  const display = new Map();
  const printable = value => {
    if (!display.has(value)) display.set(value, visible(value));
    return display.get(value);
  };
  const frames = trace(text).map(frame => ({
    ...frame,
    tokens: frame.tokens.map(token => ({ ...token, text: printable(token.text) })),
    candidate: frame.candidate && {
      ...frame.candidate,
      left: printable(frame.candidate.left),
      right: printable(frame.candidate.right),
      merged: printable(frame.candidate.left + frame.candidate.right),
      choices: frame.candidate.choices.slice(0, 6).map(choice => ({
        ...choice, left: printable(choice.left), right: printable(choice.right),
      })),
    },
  }));
  return { model: 'gpt2', version: 1, frames };
});
