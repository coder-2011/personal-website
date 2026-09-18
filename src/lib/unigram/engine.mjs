// The pinned T5 tokenizer uses Hugging Face's Precompiled normalization semantics.
function makeNormalizer(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  const trieSize = bytes.readUInt32LE(0), values = bytes.subarray(4 + trieSize);
  const units = Array.from({length:trieSize / 4}, (_, i) => bytes.readUInt32LE(4 + i * 4));
  const offset = unit => (unit >>> 10) * 2 ** ((unit & 512) >>> 6);
  const graphemes = new Intl.Segmenter('en', {granularity:'grapheme'});
  // The first prefix mapping matches HF's normalizer, including its short-grapheme rule.
  function transform(text) {
    let node = offset(units[0]);
    for (const byte of Buffer.from(text)) {
      if (byte === 0) break;
      node ^= byte;
      const unit = units[node];
      if (unit === undefined || ((unit & 0x800000ff) >>> 0) !== byte) return null;
      node ^= offset(unit);
      if (unit & 256) {
        const start = units[node] & 0x7fffffff;
        return values.subarray(start, values.indexOf(0, start)).toString('utf8');
      }
    }
    return null;
  }
  return text => Array.from(graphemes.segment(text), ({segment}) => {
    if (Buffer.byteLength(segment) < 6) {
      const mapped = transform(segment);
      if (mapped !== null) return mapped;
    }
    return Array.from(segment, char => transform(char) ?? char).join('');
  }).join('');
}

// Build a vocabulary trie once; requests only visit tokens that match the input.
export function createUnigram(model) {
  const vocab = model.model.vocab, unkId = model.model.unk_id;
  const unknownScore = Math.min(...vocab.map(([, score]) => score)) - 10;
  const normalize = makeNormalizer(model.normalizer.precompiled_charsmap);
  const root = new Map();
  vocab.forEach(([text, score], id) => {
    let node = root;
    for (const char of text) {
      if (!node.has(char)) node.set(char, new Map());
      node = node.get(char);
    }
    node.token = {id, text, score};
  });
  const added = new Map(model.added_tokens.map(token => [token.content, token.id]));
  const specials = added.size ? new RegExp('(' + [...added.keys()].sort((a,b) => b.length - a.length)
    .map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'u') : null;

  // Split added tokens before normalization, then apply WhitespaceSplit and Metaspace.
  function prepare(text) {
    const pieces = [];
    for (const section of specials ? text.split(specials) : [text]) {
      if (added.has(section)) pieces.push({text:section, special:true, id:added.get(section)});
      else for (const word of normalize(section).match(/[^\p{White_Space}]+/gu) ?? []) {
        // Metaspace also splits literal word-boundary markers already in the input.
        const marked = word.startsWith('▁') ? word : '▁' + word;
        for (const part of marked.match(/▁[^▁]*/gu) ?? []) pieces.push({text:part, special:false});
      }
    }
    if (pieces.reduce((size, piece) => size + Array.from(piece.text).length, 0) > 320)
      throw new RangeError('Normalized text is too long; use a shorter input.');
    return pieces;
  }

  // Keep one best predecessor per character boundary, then recover the complete path.
  function tracePiece(piece) {
    if (piece.special) return {...piece, visits:[], path:[], tokens:[{text:piece.text, id:piece.id}], score:0};
    const chars = Array.from(piece.text), best = Array(chars.length + 1).fill(null);
    const previous = Array(chars.length + 1).fill(null), visits = [];
    best[0] = 0;
    for (let start = 0; start < chars.length; start++) {
      const matches = [];
      let node = root;
      for (let end = start; end < chars.length; end++) {
        node = node.get(chars[end]);
        if (!node) break;
        if (node.token) matches.push({...node.token, start, end:end + 1});
      }
      if (!matches.some(token => token.end === start + 1))
        matches.push({id:unkId, text:chars[start], start, end:start + 1, score:unknownScore, unknown:true});
      for (const token of matches) {
        token.total = best[start] + token.score;
        token.previousScore = best[token.end];
        token.improved = best[token.end] === null || token.total > best[token.end];
        // Strict comparison preserves the first path when scores tie, as HF does.
        if (token.improved) {
          best[token.end] = token.total;
          previous[token.end] = token;
        }
      }
      visits.push({start, matches, best:[...best]});
    }
    const path = [];
    for (let end = chars.length; end > 0;) {
      const token = previous[end];
      path.unshift(token);
      end = token.start;
    }
    const tokens = [];
    for (const token of path) {
      const last = tokens.at(-1);
      if (token.unknown && last?.unknown) { last.text += token.text; last.end = token.end; }
      else tokens.push({id:token.id, text:token.text, start:token.start, end:token.end, unknown:!!token.unknown});
    }
    return {...piece, chars, visits, path, tokens, score:best.at(-1)};
  }

  function trace(text) {
    const pieces = prepare(text).map(tracePiece);
    return {model:'t5-small', version:1, byteLength:Buffer.byteLength(text), pieces,
      tokens:pieces.flatMap(piece => piece.tokens)};
  }
  return {trace, prepare};
}
