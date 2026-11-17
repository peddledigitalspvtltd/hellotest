const fs=require('node:fs');
const path=require('node:path');
const {deflateSync}=require('node:zlib');
let font;
function loadFont(){
 if(font)return font;
 const bytes=fs.readFileSync(path.join(__dirname,'../assets/fonts/DejaVuSans.ttf'));
 const tables={};for(let i=0;i<bytes.readUInt16BE(4);i++){const at=12+i*16;tables[bytes.toString('ascii',at,at+4)]=bytes.readUInt32BE(at+8);}
 const cmap=tables.cmap,subtables=[];
 for(let i=0;i<bytes.readUInt16BE(cmap+2);i++){const at=cmap+4+i*8,offset=cmap+bytes.readUInt32BE(at+4),format=bytes.readUInt16BE(offset);if(format===4||format===12)subtables.push({offset,format});}
 subtables.sort((a,b)=>b.format-a.format);
 const glyph=point=>{
  for(const {offset,format} of subtables){
   if(format===12){let low=0,high=bytes.readUInt32BE(offset+12)-1;while(low<=high){const mid=(low+high)>>1,at=offset+16+mid*12,start=bytes.readUInt32BE(at),end=bytes.readUInt32BE(at+4);if(point<start)high=mid-1;else if(point>end)low=mid+1;else return bytes.readUInt32BE(at+8)+point-start;}}
   else if(point<=65535){const count=bytes.readUInt16BE(offset+6)/2,end=offset+14,start=end+count*2+2,delta=start+count*2,range=delta+count*2;for(let i=0;i<count;i++){if(point>bytes.readUInt16BE(end+i*2))continue;if(point<bytes.readUInt16BE(start+i*2))break;const shift=bytes.readInt16BE(delta+i*2),skip=bytes.readUInt16BE(range+i*2);if(!skip)return(point+shift)&65535;const at=range+i*2+skip+(point-bytes.readUInt16BE(start+i*2))*2;const value=bytes.readUInt16BE(at);return value?(value+shift)&65535:0;}}
  }return 0;
 };
 const units=bytes.readUInt16BE(tables.head+18),metricCount=bytes.readUInt16BE(tables.hhea+34);
 font={bytes,glyph,width:id=>Math.round(bytes.readUInt16BE(tables.hmtx+Math.min(id,metricCount-1)*4)*1000/units),
  ascent:Math.round(bytes.readInt16BE(tables.hhea+4)*1000/units),descent:Math.round(bytes.readInt16BE(tables.hhea+6)*1000/units),
  bbox:Array.from({length:4},(_,i)=>Math.round(bytes.readInt16BE(tables.head+36+i*2)*1000/units))};return font;
}
const utf16hex=text=>{const b=Buffer.from(text,'utf16le');b.swap16();return b.toString('hex').toUpperCase();};
function createReportPdfFont(){
 const source=loadFont(),chars=new Map();
 const encode=value=>{let text='';for(const char of String(value??'')){if(!chars.has(char))chars.set(char,chars.size+1);text+=chars.get(char).toString(16).padStart(4,'0');}return `<${text}>`;};
 const register=addObject=>{
  const stream=(data,extra='')=>{const compressed=deflateSync(data);return addObject(Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode ${extra} >>\nstream\n`),compressed,Buffer.from('\nendstream')]));};
  const fontFile=stream(source.bytes,`/Length1 ${source.bytes.length}`);
  const descriptor=addObject(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${source.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${source.ascent} /Descent ${source.descent} /CapHeight ${source.ascent} /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
  const mappings=Buffer.alloc((chars.size+1)*2),widths=[],unicode=[];
  for(const [char,cid] of chars){const glyph=source.glyph(char.codePointAt(0));mappings.writeUInt16BE(glyph,cid*2);widths.push(source.width(glyph));unicode.push(`<${cid.toString(16).padStart(4,'0')}> <${utf16hex(char)}>`);}
  const map=stream(mappings),cmap=['/CIDInit /ProcSet findresource begin','12 dict begin','begincmap','/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def','/CMapName /ReportUnicode def','/CMapType 2 def','1 begincodespacerange','<0000> <FFFF>','endcodespacerange'];
  for(let i=0;i<unicode.length;i+=100){const batch=unicode.slice(i,i+100);cmap.push(`${batch.length} beginbfchar`,...batch,'endbfchar');}cmap.push('endcmap','CMapName currentdict /CMap defineresource pop','end','end');
  const toUnicode=stream(Buffer.from(cmap.join('\n'),'ascii'));
  const descendant=addObject(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${map} 0 R /DW 600 /W [1 [${widths.join(' ')}]] >>`);
  return addObject(`<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
 };
 const measureText=(value,size)=>Array.from(String(value??'')).reduce((total,char)=>total+source.width(source.glyph(char.codePointAt(0))),0)*size/1000;
 return{encode,register,measureText};
}
module.exports={createReportPdfFont};
