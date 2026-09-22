import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlogStore } from '../src/lib/blog/store.mjs';
import { redirectBlogAlias } from '../src/lib/blog/slugs.mjs';

test('old article and polling URLs redirect with query parameters intact', () => {
  for (const prefix of ['/blog/', '/api/blog/posts/']) for (const method of ['GET', 'HEAD']) {
    const response = redirectBlogAlias(new Request(`https://naman.world${prefix}snaptokens-blog/?revision=old`, {method}));
    assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),`https://naman.world${prefix}snaptokens?revision=old`);
  }
  for (const path of ['/blog/snaptokens','/blog/another','/api/publish','/api/blog/assets/snaptokens-blog']) {
    assert.equal(redirectBlogAlias(new Request(`https://naman.world${path}`)),null);
  }
});

test('the renamed post retains its identity, accepts old plugin saves, and still unpublishes', async () => {
  const entries = [{id:'post-id',slug:'snaptokens-blog',revision:'old-revision',published:true,assets:[]}];
  const content = {id:'post-id',slug:'snaptokens-blog',title:'Snaptokens',markdown:'Unchanged source',html:'<p>Unchanged source</p>',assets:[]};
  const values = new Map([
    ['blog/index.json',JSON.stringify(entries)],
    ['blog/revisions/post-id/old-revision.json',JSON.stringify({...content,revision:'old-revision'})],
  ]);
  const store = createBlogStore({
    read:async path => values.has(path) ? {text:values.get(path),etag:'test'} : null,
    write:async (path,text) => values.set(path,text), conflict:()=>false,
  });
  assert.equal((await store.list())[0].slug,'snaptokens');
  const current = await store.post('snaptokens');
  assert.equal(current.slug,'snaptokens');
  assert.equal(current.id,'post-id');
  assert.equal(current.markdown,content.markdown);
  assert.equal(current.revision,'old-revision');
  assert.equal(await store.post('snaptokens-blog'),null);
  const updated = await store.publish({...content,markdown:'New live edit',baseVersion:'old-revision'});
  assert.equal(updated.slug,'snaptokens');
  assert.equal((await store.post('snaptokens')).markdown,'New live edit');
  assert.equal(JSON.parse(values.get('blog/index.json'))[0].slug,'snaptokens');
  await assert.rejects(store.publish({...content,id:'different-id',baseVersion:null}),/belongs to another/);
  await store.unpublish(content.id,updated.revision);
  assert.equal(await store.post('snaptokens'),null);
});
