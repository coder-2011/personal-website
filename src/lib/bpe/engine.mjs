// GPT-2 byte-level BPE. The browser uses the same pinned model as the parity check.
export function createBPE(model) {
  const vocab = model.model.vocab;
  const ranks = new Map(model.model.merges.map((pair, rank) => [pair, rank]));
  const byteSymbols = new Map();
  for (let byte = 0; byte < 256; byte++) {
    if ((byte >= 33 && byte <= 126) || (byte >= 161 && byte <= 172) || byte >= 174)
      byteSymbols.set(byte, String.fromCodePoint(byte));
  }
  let extra = 256;
  for (let byte = 0; byte < 256; byte++) {
    if (!byteSymbols.has(byte)) byteSymbols.set(byte, String.fromCodePoint(extra++));
  }
  const symbolBytes = new Map(Array.from(byteSymbols, ([byte, symbol]) => [symbol, byte]));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
  // Unicode White_Space matches GPT-2's regex semantics, unlike JavaScript's \s.
  const pattern = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\p{White_Space}\p{L}\p{N}]+|\p{White_Space}+(?![^\p{White_Space}])|\p{White_Space}+/gu;
  const special = '<|endoftext|>';

  // Preserve pre-tokenizer boundaries and recognize GPT-2's one added token.
  function initialTokens(text) {
    const tokens = [], pieces = [];
    let offset = 0;
    for (const section of text.split(/(<\|endoftext\|>)/u)) {
      if (section === special) {
        const piece = pieces.length;
        pieces.push(section);
        tokens.push({text:section, id:50256, start:offset, end:offset + section.length, piece, special:true});
        offset += section.length;
        continue;
      }
      for (const match of section.matchAll(pattern)) {
        const piece = pieces.length;
        pieces.push(match[0]);
        for (const byte of encoder.encode(match[0])) {
          const symbol = byteSymbols.get(byte);
          tokens.push({text:symbol, id:vocab[symbol], start:offset, end:++offset, piece});
        }
      }
    }
    return {tokens, pieces, byteLength:offset};
  }

  // Process pieces left to right; choose the lowest-ranked pair within each piece.
  function nextCandidate(tokens) {
    let piece = null;
    const choices = new Map();
    for (let i = 0; i < tokens.length - 1; i++) {
      const left = tokens[i], right = tokens[i + 1];
      if (piece !== null && left.piece !== piece) break;
      if (left.special || right.special || left.piece !== right.piece) continue;
      const rank = ranks.get(left.text + ' ' + right.text);
      if (rank === undefined) continue;
      piece = left.piece;
      choices.set(rank, {rank, left:left.text, right:right.text});
    }
    if (!choices.size) return null;
    const available = Array.from(choices.values()).sort((a,b) => a.rank - b.rank);
    const best = available[0], indices = [];
    // GPT-2 merges every non-overlapping occurrence of the winning pair in this piece.
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].piece === piece && tokens[i + 1].piece === piece &&
          tokens[i].text === best.left && tokens[i + 1].text === best.right) {
        indices.push(i++);
      }
    }
    return {...best, indices, piece, choices:available};
  }

  function trace(text) {
    let {tokens, pieces, byteLength} = initialTokens(text);
    const history = [];
    for (;;) {
      const candidate = nextCandidate(tokens);
      history.push({tokens, candidate, pieces, byteLength});
      if (!candidate) return history;
      const selected = new Set(candidate.indices), next = [];
      for (let i = 0; i < tokens.length; i++) {
        if (!selected.has(i)) { next.push(tokens[i]); continue; }
        const left = tokens[i], right = tokens[++i], merged = left.text + right.text;
        next.push({...left, text:merged, id:vocab[merged], end:right.end});
      }
      tokens = next;
    }
  }

  // Incomplete UTF-8 fragments remain explicit bytes until a merge makes them readable.
  function visible(symbols) {
    if (symbols === special) return special;
    const bytes = Uint8Array.from(symbols, symbol => symbolBytes.get(symbol));
    let text;
    try { text = decoder.decode(bytes); }
    catch { return Array.from(bytes, byte => '\\x' + byte.toString(16).padStart(2,'0').toUpperCase()).join(''); }
    return text.replaceAll(' ', '␣').replaceAll('\n', '↵').replaceAll('\r', '␍').replaceAll('\t', '⇥')
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, char => '\\u{' + char.codePointAt(0).toString(16).toUpperCase() + '}');
  }
  return {trace, visible};
}
