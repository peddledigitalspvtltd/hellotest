// Authored rich text becomes inert plain text before credential redaction and
// final HTML/PDF encoding. Report renderers never trust author-supplied markup.
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function reportText(value) {
  return String(value??'').replace(/<\s*(script|style|iframe|object)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,'')
    .replace(/<\s*br\s*\/?\s*>/gi,'\n').replace(/<\s*li\b[^>]*>/gi,'\n• ')
    .replace(/<\s*\/(?:p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi,'\n')
    .replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
      if(entity[0]!=='#')return ENTITIES[entity.toLowerCase()]??_;
      const point=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
      return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
    }).replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
module.exports={reportText};
