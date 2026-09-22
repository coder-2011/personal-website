import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlogStore } from '../src/lib/blog/store.mjs';
import { redirectBlogAlias } from '../src/lib/blog/slugs.mjs';

test('old article and polling URLs redirect with query parameters intact', () => {
  const entries = [{slug:'snaptokens',aliases:['snaptokens-blog'],published:true}];
  for (const prefix of ['/blog/', '/api/blog/posts/']) for (const method of ['GET', 'HEAD']) {
    const response = redirectBlogAlias(new Request(`https://naman.world${prefix}snaptokens-blog/?revision=old`, {method}),entries);
    assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),`https://naman.world${prefix}snaptokens?revision=old`);
  }
  for (const path of ['/blog/snaptokens','/blog/another','/api/publish','/api/blog/assets/snaptokens-blog']) {
    assert.equal(redirectBlogAlias(new Request(`https://naman.world${path}`),entries),null);
  }
});

test('reviewed renames reserve old URLs, reject stale changes, and do not let old plugins undo a rename', async () => {
  const values = new Map();
  const store = createBlogStore({
    read:async path => values.has(path) ? {text:values.get(path),etag:'test'} : null,
    write:async (path,text) => values.set(path,text), conflict:()=>false,
  });
  const input = {id:'post-id',slug:'first-url',title:'Note',markdown:'Public',html:'<p>Public</p>',assets:[],baseVersion:null};
  const first = await store.publish(input);
  const rename = {...input,slug:'second-url',baseVersion:first.revision};
  await assert.rejects(store.publish(rename),/Use Change URL/);
  await assert.rejects(store.publish({...rename,previousSlug:'wrong-url'}),/current URL changed/);
  const second = await store.publish({...rename,previousSlug:'first-url'});
  assert.equal(second.id,first.id);
  assert.equal(second.slug,'second-url');
  assert.deepEqual(second.aliases,['first-url']);
  assert.equal((await store.publish({...rename,previousSlug:'first-url'})).revision,second.revision,'retry is idempotent');
  await assert.rejects(store.publish({...input,slug:'third-url',previousSlug:'first-url',baseVersion:first.revision}),/changed elsewhere/);
  const oldClient = await store.publish({...input,baseVersion:second.revision,markdown:'New text from old plugin'});
  assert.equal(oldClient.slug,'second-url');
  assert.equal((await store.post('second-url')).markdown,'New text from old plugin');
  await assert.rejects(store.publish({...input,id:'other'}),/reserved/);
  await assert.rejects(store.publish({...input,previousSlug:'second-url',baseVersion:oldClient.revision}),/reserved/);
  const third = await store.publish({...input,slug:'third-url',previousSlug:'second-url',baseVersion:oldClient.revision});
  assert.deepEqual(third.aliases,['first-url','second-url']);
  for (const slug of third.aliases) {
    const response = redirectBlogAlias(new Request(`https://naman.world/blog/${slug}`),await store.list());
    assert.equal(response.headers.get('location'),'https://naman.world/blog/third-url','all old URLs go straight to the latest URL');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  await store.unpublish(third.id,third.revision);
  for (const slug of [...third.aliases,third.slug]) {
    assert.equal(await store.post(slug),null);
    assert.equal(redirectBlogAlias(new Request(`https://naman.world/blog/${slug}`),await store.list()),null);
  }
  await assert.rejects(store.publish({...input,id:'other'}),/reserved/,'unpublishing does not release an old link to another post');
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
  const renamed = await store.publish({...content,slug:'quick-tokenizer',previousSlug:'snaptokens',baseVersion:updated.revision});
  assert.equal((await store.list())[0].slug,'quick-tokenizer','the old one-off migration must not override later renames');
  assert.deepEqual(renamed.aliases,['snaptokens-blog','snaptokens']);
  await store.unpublish(content.id,renamed.revision);
  assert.equal(await store.post('snaptokens'),null);
  assert.equal(await store.post('quick-tokenizer'),null);
});
