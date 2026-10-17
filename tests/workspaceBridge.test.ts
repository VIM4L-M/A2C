import { describe, expect, it } from 'vitest';
import { workspaceMessage, trustedWorkspace, BRIDGE_KEY, PENDING_KEY } from '../apps/extension/src/lib/workspaceBridge';
import { memoryKV, STORAGE_KEYS } from '../apps/extension/src/lib/storage';
import { prepareFact } from '../apps/extension/src/memory/facts';

const url='http://127.0.0.1:5174/workspace/workspace.html#settings';
function fact(key:string,value:string) { const c=prepareFact({key,value,source:'manual'}); if(!c.ok) throw Error(c.error);return c.fact; }
describe('explicit website connection',()=>{
  it('only accepts the exact workspace origin and path',()=>{
    expect(trustedWorkspace(url)).toBe(true);
    for(const u of ['https://evil.example/workspace/workspace.html','http://127.0.0.1:5175/workspace/workspace.html','http://127.0.0.1:5174/registration.html','http://localhost:5174/workspace/workspace.html']) expect(trustedWorkspace(u)).toBe(false);
  });
  it('requires a grant and denies revoked or untrusted clients',async()=>{
    const kv=memoryKV();expect(await workspaceMessage({type:'snapshot'},url,kv)).toMatchObject({ok:false});
    await kv.set(BRIDGE_KEY,{enabled:true,shareActivity:false,keys:[]});
    expect(await workspaceMessage({type:'snapshot'},'https://evil.example',kv)).toMatchObject({ok:false});
    await kv.set(BRIDGE_KEY,{enabled:false,shareActivity:false,keys:[]});
    expect(await workspaceMessage({type:'snapshot'},url,kv)).toMatchObject({ok:false});
  });
  it('exports only selected eligible facts and strips site provenance, never settings or private data',async()=>{
    const name=fact('full_name','Alex Example');name.allowedSites=['https://example.org'];name.provenance.domain='https://example.org';
    const college=fact('college','Example University');college.permission='never';
    const kv=memoryKV({[BRIDGE_KEY]:{enabled:true,shareActivity:false,keys:['full_name','college','phone']},[STORAGE_KEYS.memory]:[name,college,fact('phone','+1 202 555 0100')],[STORAGE_KEYS.settings]:{authToken:'secret-token'}});
    const r=await workspaceMessage({type:'snapshot'},url,kv) as {facts:typeof name[],activity:unknown};
    expect(r.facts.map(f=>f.key)).toEqual(['full_name']);expect(r.facts[0]?.allowedSites).toEqual([]);expect(r.facts[0]?.provenance.domain).toBeUndefined();expect(r.activity).toBeNull();expect(JSON.stringify(r)).not.toContain('secret-token');
  });
  it('queues proposals without storing them as facts, refuses secrets, disabled categories and overwrite of denied facts',async()=>{
    const kv=memoryKV({[BRIDGE_KEY]:{enabled:true,shareActivity:true,keys:[]}});
    expect(await workspaceMessage({type:'propose',facts:[{key:'full_name',label:'Name',value:'Alex Example'}]},url,kv)).toMatchObject({ok:true,pending:1});
    expect(await kv.get(STORAGE_KEYS.memory)).toBeUndefined();expect(await kv.get(PENDING_KEY)).toHaveLength(1);
    expect(await workspaceMessage({type:'propose',facts:[{key:'full_name',label:'Name',value:'Other'}]},url,kv)).toMatchObject({ok:false});
    await kv.remove(PENDING_KEY);
    expect(await workspaceMessage({type:'propose',facts:[{key:'password',label:'Password',value:'secret'}]},url,kv)).toMatchObject({ok:false});
    await kv.set(STORAGE_KEYS.settings,{disabledCategories:['identity']});
    expect(await workspaceMessage({type:'propose',facts:[{key:'full_name',label:'Name',value:'Alex Example'}]},url,kv)).toMatchObject({ok:false});
  });
});
