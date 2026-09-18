T5 Unigram vocabulary, scores, added tokens, and normalization map from
google-t5/t5-small, pinned to commit df1b051c49625cf57a3d0d8d3863ed4d13564fe4:
https://huggingface.co/google-t5/t5-small/blob/df1b051c49625cf57a3d0d8d3863ed4d13564fe4/tokenizer.json

The model is Apache-2.0 licensed. The license is in T5-LICENSE.
The trace follows Hugging Face Tokenizers' deterministic Unigram decoding,
WhitespaceSplit + Metaspace pre-tokenization, and Precompiled normalization.
It does not append the task-level end-of-sequence token (add_special_tokens=false).
Adjacent unknown characters are fused into one unknown token per text piece.

Normalizer format and traversal reference (Apache-2.0):
https://github.com/huggingface/spm_precompiled/blob/master/src/lib.rs
Unigram and normalization reference (Apache-2.0):
https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/models/unigram/model.rs
https://github.com/huggingface/tokenizers/blob/main/tokenizers/src/normalizers/precompiled.rs
