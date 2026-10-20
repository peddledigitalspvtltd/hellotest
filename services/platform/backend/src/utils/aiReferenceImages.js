const { createHash } = require('node:crypto');

// These are application input limits, not provider-specific token estimates.
const IMAGE_LIMITS = Object.freeze({ max_images: 6, max_total_chars: 950_000, detail: 'low' });
const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_AI_REFERENCE_IMAGE', statusCode: 400, publicMessage: message });
function rasterDimensions(bytes, mime) {
  if (mime==='png' && bytes.length>=33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR') return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if (['jpg','jpeg'].includes(mime) && bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
    let cursor=2;
    while(cursor+4<=bytes.length){
      if(bytes[cursor++]!==255)return null;
      while(cursor<bytes.length&&bytes[cursor]===255)cursor++;
      const marker=bytes[cursor++];
      if(marker===0xD9||marker===0xDA)return null;
      if(marker===0x01||(marker>=0xD0&&marker<=0xD7))continue;
      if(cursor+2>bytes.length)return null;
      const length=bytes.readUInt16BE(cursor);
      if(length<2||cursor+length>bytes.length)return null;
      if([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker))return length>=8?[bytes.readUInt16BE(cursor+5),bytes.readUInt16BE(cursor+3)]:null;
      cursor+=length;
    }
  }
  if(mime==='webp'&&bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    if(bytes.readUInt32LE(4)+8>bytes.length)return null;
    for(let cursor=12,chunks=0;cursor+8<=bytes.length&&chunks++<64;){
      const kind=bytes.toString('ascii',cursor,cursor+4),length=bytes.readUInt32LE(cursor+4),start=cursor+8;
      if(start+length>bytes.length)return null;
      if(kind==='VP8X'&&length>=10)return[1+bytes.readUIntLE(start+4,3),1+bytes.readUIntLE(start+7,3)];
      if(kind==='VP8L'&&length>=5&&bytes[start]===0x2F){const dimensions=bytes.readUInt32LE(start+1);return[1+(dimensions&0x3FFF),1+((dimensions>>>14)&0x3FFF)];}
      if(kind==='VP8 '&&length>=10&&bytes[start+3]===0x9D&&bytes[start+4]===0x01&&bytes[start+5]===0x2A)return[bytes.readUInt16LE(start+6)&0x3FFF,bytes.readUInt16LE(start+8)&0x3FFF];
      cursor=start+length+(length%2);
    }
  }
  return null;
}

function normalizeReferenceImages(images, { max_images = IMAGE_LIMITS.max_images, max_total_chars = IMAGE_LIMITS.max_total_chars } = {}) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw invalid('Reference images must be an array.');
  if (images.length > Math.min(max_images, IMAGE_LIMITS.max_images)) throw invalid(`Reference images are limited to ${Math.min(max_images, IMAGE_LIMITS.max_images)}.`);
  let total = 0;
  const seen = new Set();
  return images.flatMap((image, index) => {
    const match = typeof image?.url==='string' && /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(image.url);
    if (!match) {
      throw invalid(`Reference image ${index + 1} must be a compressed PNG, JPEG, or WebP data URL.`);
    }
    total += image.url.length;
    if (total > Math.min(max_total_chars, IMAGE_LIMITS.max_total_chars)) throw invalid('Reference images exceed the supported compressed image budget. Crop or remove an image.');
    const bytes=Buffer.from(match[2],'base64');
    if(bytes.toString('base64')!==match[2])throw invalid(`Reference image ${index+1} has invalid base64 encoding.`);
    const dimensions=rasterDimensions(bytes,match[1].toLowerCase());
    if(!dimensions||dimensions.some(value=>!value||value>8192)||dimensions[0]*dimensions[1]>20_000_000)throw invalid(`Reference image ${index+1} must contain a valid bounded raster image matching its PNG, JPEG, or WebP type. Crop large screenshots before uploading.`);
    const canonicalMime=['jpg','jpeg'].includes(match[1].toLowerCase())?'jpeg':match[1].toLowerCase();
    const url=`data:image/${canonicalMime};base64,${bytes.toString('base64')}`;
    const content_hash = createHash('sha256').update(bytes).digest('hex');
    if (seen.has(content_hash)) return [];
    seen.add(content_hash);
    return [{ name: String(image.name || `Reference image ${index + 1}`).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 255), url, content_hash }];
  });
}

function imageUserContent(prompt, images = [], detail = 'low') {
  const normalized = normalizeReferenceImages(images);
  return normalized.length ? [{ type: 'text', text: prompt }, ...normalized.map(image => ({ type: 'image_url', image_url: { url: image.url, detail } }))] : prompt;
}

function applyReferenceImagePolicy(payload, { integration, policy = IMAGE_LIMITS } = {}) {
  const parts = (payload.messages || []).flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part?.type === 'image_url');
  if (!parts.length) return payload;
  // Only an explicit integration setting is authoritative. Model-name guesses
  // would reject vision-capable private deployments or silently lose evidence.
  if (integration?.config?.supports_vision === false) throw Object.assign(new Error('The selected model is configured without image support. Select a vision-capable integration or remove the reference images.'), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 });
  normalizeReferenceImages(parts.map(part => ({ url: part.image_url?.url })), policy);
  return { ...payload, messages: payload.messages.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => part?.type === 'image_url' ? { ...part, image_url: { ...part.image_url, detail: policy.detail || 'low' } } : part) : message.content })) };
}

const isVisionRejection = (status, detail) => [400, 415, 422].includes(Number(status)) && /(?:image|vision|multimodal|image_url)/i.test(String(detail || '')) && /(?:unsupported|not supported|does not support|not accept|text.only|invalid.*(?:image|content.type))/i.test(String(detail || ''));
module.exports = { IMAGE_LIMITS, normalizeReferenceImages, imageUserContent, applyReferenceImagePolicy, isVisionRejection };
