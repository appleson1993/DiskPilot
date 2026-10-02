const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MiB, GiB, gaps, validateRequest } = require('../src/model.cjs');
test('maps only real usable gaps, excluding disk alignment space',()=>{
  const disk={size:70*GiB,partitions:[{offset:MiB,size:50*MiB},{offset:51*MiB,size:49*GiB},{offset:51*MiB+49*GiB,size:GiB}]};
  const free=gaps(disk);assert.equal(free.length,1);assert.equal(free[0].offset,51*MiB+50*GiB);assert.equal(free[0].offset+free[0].size,70*GiB-MiB);
});
test('partition array need not already be sorted',()=>{const d={size:GiB,partitions:[{offset:200*MiB,size:100*MiB},{offset:MiB,size:99*MiB}]};assert.deepEqual(gaps(d)[0],{offset:100*MiB,size:100*MiB});});
test('renderer cannot inject commands or arbitrary actions',()=>{for(const input of [{kind:'exec',diskNumber:0},{kind:'resize',diskNumber:'0; Remove-Partition',partitionNumber:2,size:GiB},{kind:'create',diskNumber:0,offset:MiB,size:GiB,label:'x',letter:'R;format',fileSystem:'NTFS'}])assert.throws(()=>validateRequest(input));});
test('invalid and unsafe sizes are rejected',()=>{for(const size of [NaN,Infinity,-1,1.1,Number.MAX_SAFE_INTEGER+1,0,MiB])assert.throws(()=>validateRequest({kind:'resize',diskNumber:0,partitionNumber:2,size}));});
test('only NTFS and valid labels are accepted',()=>{for(const label of ['test:bad','x'.repeat(33),'x\u0000y'])assert.throws(()=>validateRequest({kind:'rename',diskNumber:0,partitionNumber:2,label}));assert.throws(()=>validateRequest({kind:'format',diskNumber:0,partitionNumber:2,label:'DATA',fileSystem:'FAT32'}));});
test('drops untrusted fields and accepts valid resize',()=>{assert.deepEqual(validateRequest({kind:'resize',diskNumber:0,partitionNumber:2,size:50*GiB,command:'evil',fingerprint:'fake'}),{kind:'resize',diskNumber:0,partitionNumber:2,size:50*GiB});});
test('creation requires exact gap location and unused-letter candidate',()=>{assert.throws(()=>validateRequest({kind:'create',diskNumber:0,size:GiB,label:'資料',letter:'D',fileSystem:'NTFS'}));assert.equal(validateRequest({kind:'create',diskNumber:0,offset:MiB,size:GiB,label:'資料',letter:'D',fileSystem:'NTFS'}).letter,'D');});
