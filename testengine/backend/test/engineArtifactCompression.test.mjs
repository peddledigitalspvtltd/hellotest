import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compressBrowserVideo } from '../dist/lib/engineArtifacts.js';
const execute = promisify(execFile);

test('optional video transcoding reduces a real WebM without upscaling or losing its duration', {
  skip:process.env.FFMPEG_SMOKE!=='1',timeout:120000
}, async t => {
  const root=await mkdtemp(join(tmpdir(),'hellotest-video-compression-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'original.webm'),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
  await execute(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',"nullsrc=s=640x360:r=12,geq=lum='random(1)*255':cb=128:cr=128",'-t','4','-an','-c:v','libvpx-vp9','-lossless','1','-deadline','realtime','-cpu-used','8','-threads','2',file],{timeout:60000,maxBuffer:65536});
  const before=await stat(file);assert.ok(before.size>8*1024*1024,`Fixture must exercise transcoding, got ${before.size} bytes.`);
  const output=await compressBrowserVideo(file);assert.notEqual(output,file,'A smaller transcoded artifact is selected.');
  assert.ok((await stat(output)).size<before.size);assert.equal((await stat(file)).size,before.size,'The original evidence stays available.');
  const inspect=async target=>JSON.parse((await execute(ffprobe,['-v','error','-show_entries','stream=width,height:format=duration','-of','json',target],{timeout:15000})).stdout);
  const original=await inspect(file),compressed=await inspect(output);
  assert.ok(compressed.streams[0].width<=original.streams[0].width);assert.ok(compressed.streams[0].height<=original.streams[0].height);
  assert.ok(Math.abs(Number(original.format.duration)-Number(compressed.format.duration))<0.15);
  await execute(ffmpeg,['-nostdin','-v','error','-i',output,'-f','null','-'],{timeout:30000,maxBuffer:65536});
});
