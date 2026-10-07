import { deflateSync, inflateSync } from "node:zlib";
import { QualityError } from "./contracts.js";
export type RgbaImage = { width: number; height: number; pixels: Buffer };
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name,data]))); return Buffer.concat([length,name,data,crc]); }
export function encodePng(image: RgbaImage) {
  const header = Buffer.alloc(13); header.writeUInt32BE(image.width); header.writeUInt32BE(image.height,4); header[8]=8; header[9]=6;
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y=0; y<image.height; y++) image.pixels.copy(rows, y*(image.width*4+1)+1, y*image.width*4, (y+1)*image.width*4);
  return Buffer.concat([signature,chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
export function decodePng(bytes: Buffer): RgbaImage {
  if (!bytes.subarray(0,8).equals(signature)) throw new QualityError("QUALITY_BASELINE_INVALID", "Visual evidence must be a PNG screenshot.");
  let width=0,height=0,channels=0; const compressed: Buffer[]=[];
  for (let offset=8; offset+12<=bytes.length;) {
    const length=bytes.readUInt32BE(offset), type=bytes.toString("ascii",offset+4,offset+8), data=bytes.subarray(offset+8,offset+8+length);
    if (offset+12+length>bytes.length) throw new QualityError("QUALITY_BASELINE_INVALID", "Truncated PNG evidence.");
    if (type==="IHDR") { width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===6?4:data[9]===2?3:0; if(data[8]!==8 || data[12]!==0 || !channels || !width || !height || width*height>2304000) throw new QualityError("QUALITY_BASELINE_INVALID", "Unsupported screenshot dimensions or PNG format."); }
    if(type==="IDAT") compressed.push(data);
    offset+=length+12;
  }
  if(!channels) throw new QualityError("QUALITY_BASELINE_INVALID","PNG header missing.");
  const stride=width*channels, raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height) throw new QualityError("QUALITY_BASELINE_INVALID","Unexpected screenshot data length.");
  const reconstructed=Buffer.alloc(stride*height), pixels=Buffer.alloc(width*height*4);
  const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new QualityError("QUALITY_BASELINE_INVALID","Unsupported PNG filter.");for(let x=0;x<stride;x++){const a=x>=channels?reconstructed[y*stride+x-channels]:0,b=y?reconstructed[(y-1)*stride+x]:0,c=y&&x>=channels?reconstructed[(y-1)*stride+x-channels]:0; reconstructed[y*stride+x]=(raw[y*(stride+1)+x+1]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;}}
  for(let index=0;index<width*height;index++){pixels[index*4]=reconstructed[index*channels];pixels[index*4+1]=reconstructed[index*channels+1];pixels[index*4+2]=reconstructed[index*channels+2];pixels[index*4+3]=channels===4?reconstructed[index*channels+3]:255;}
  return {width,height,pixels};
}
export function comparePng(baseline: Buffer, current: Buffer, threshold=16) {
  const a=decodePng(baseline),b=decodePng(current);
  if(a.width!==b.width||a.height!==b.height) throw new QualityError("QUALITY_BASELINE_DIMENSIONS","Baseline and current screenshots have different dimensions.",409);
  const diff=Buffer.alloc(a.pixels.length); let changed=0;
  for(let i=0;i<a.pixels.length;i+=4){const differs=[0,1,2,3].some(channel=>Math.abs(a.pixels[i+channel]-b.pixels[i+channel])>threshold);if(differs)changed++;diff[i]=differs?229:Math.round((b.pixels[i]+b.pixels[i+1]+b.pixels[i+2])/3);diff[i+1]=differs?60:diff[i];diff[i+2]=differs?85:diff[i];diff[i+3]=255;}
  return {changed_pixels:changed,total_pixels:a.width*a.height,diff_ratio:changed/(a.width*a.height),diff:encodePng({width:a.width,height:a.height,pixels:diff})};
}
