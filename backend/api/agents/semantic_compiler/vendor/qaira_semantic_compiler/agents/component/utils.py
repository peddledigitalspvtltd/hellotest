from __future__ import annotations
from pathlib import Path
from typing import Any, Dict, List
import re, json, csv, hashlib
from qaira_semantic_compiler.core.ignore import QAIgnore

UI_EXTS = {'.tsx', '.jsx', '.vue', '.svelte', '.html', '.ts'}
JS_EXTS = {'.ts', '.tsx', '.js', '.jsx'}
COMP_RE = re.compile(r"(?:export\s+default\s+function|export\s+function|function|const|export\s+const)\s+([A-Z][A-Za-z0-9_]*)\b(?:\s*=\s*(?:\([^)]*\)|[^=]+?)\s*=>)?", re.S)
EXPORT_RE = re.compile(r"export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)")
IMPORT_RE = re.compile(r"import\s+(?:\{([^}]+)\}|([A-Za-z0-9_]+))\s+from\s+['\"]([^'\"]+)['\"]")
JSX_TAG_RE = re.compile(r"<([A-Za-z][A-Za-z0-9._:-]*)(\s[^<>]*?)?>", re.S)
ATTR_RE = re.compile(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|\{([^}]*)\})")
TEXT_RE = re.compile(r">\s*([^<>{}\n][^<>{}\n]{0,120})\s*<")
API_CALL_RE = re.compile(r"(?:fetch\s*\(\s*|axios\.(get|post|put|patch|delete)\s*\(\s*|\.(get|post|put|patch|delete)\s*\(\s*)['\"]([^'\"]+)['\"]", re.I)
EVENT_ATTRS = {'onClick','onChange','onSubmit','onBlur','onFocus','onSearch','onSelect','onUpload','onDelete','onEdit','onSave','onCancel','onRetry','onNext','onPrevious','onKeyDown'}
INTERACTIVE_TAGS = {'button','input','select','textarea','a','option'}
ROLE_BY_TAG = {'button':'button','a':'link','input':'textbox','select':'combobox','textarea':'textbox','form':'form','dialog':'dialog'}
BAD_LOCATOR_TEXT = re.compile(r"(=>|\bset[A-Z]|\bhandle[A-Z]|\bon[A-Z]|event\.|currentTarget|target\.value|target\.checked|\$\{|`|\)\s*=>|\bvoid\s+|\bMath\.|\bNumber\(|\[\]|\.mutate\(|\.current|stopPropagation|preventDefault)")
MEANINGLESS_TEXT = re.compile(r"^[\s\W_0-9]{1,4}$")

def rel(root: Path, p: Path) -> str:
    try: return str(p.relative_to(root))
    except Exception: return str(p)

def slug(s: str) -> str:
    s = str(s or 'component').replace('Page.tsx','Page').replace('.tsx','')
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', s)
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s or 'component'

def pascal(s: str) -> str:
    raw = re.sub(r'[^A-Za-z0-9]+', ' ', str(s or 'Component')).strip().split()
    out = ''.join(x[:1].upper()+x[1:] for x in raw)
    return out if out and out[0].isalpha() else 'QairaComponent'

def camel(s: str) -> str:
    p = pascal(s)
    return p[:1].lower()+p[1:]

def read_text(p: Path) -> str:
    try: return p.read_text(encoding='utf-8', errors='ignore')
    except Exception: return ''

def iter_ui_files(source: Path, config: dict):
    ignore = QAIgnore(source, config)
    for p in source.rglob('*'):
        if not p.is_file() or p.suffix.lower() not in UI_EXTS: continue
        rp = rel(source, p)
        if ignore.is_ignored(rp): continue
        yield p

def parse_attrs(raw: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for m in ATTR_RE.finditer(raw or ''):
        out[m.group(1)] = next((g for g in m.groups()[1:] if g is not None), '')
    return out

def nearby_text(text: str, pos: int) -> str:
    m = TEXT_RE.search(text[pos:pos+260])
    if not m: return ''
    val = re.sub(r'\s+', ' ', m.group(1)).strip()
    return val if not BAD_LOCATOR_TEXT.search(val) else ''

def clean_name(s: str) -> str:
    s = re.sub(r'\s+', ' ', str(s or '')).strip().strip('"\'`')
    s = s[:160]
    return s

def is_bad_user_text(s: str) -> bool:
    s = clean_name(s)
    if not s or BAD_LOCATOR_TEXT.search(s) or MEANINGLESS_TEXT.match(s): return True
    return False

def role_for(tag: str, attrs: Dict[str,str]) -> str:
    tag = (tag or '').lower()
    role = attrs.get('role') or ROLE_BY_TAG.get(tag, '')
    if tag == 'input':
        typ = (attrs.get('type') or 'text').lower()
        if typ == 'checkbox': return 'checkbox'
        if typ == 'radio': return 'radio'
        if typ in {'submit','button'}: return 'button'
        if typ in {'file'}: return 'button'
    return role

def locator_candidates(tag: str, attrs: Dict[str,str], text: str) -> List[Dict[str,Any]]:
    tag_l = (tag or '').lower(); role = role_for(tag_l, attrs); out=[]
    testid = attrs.get('data-testid') or attrs.get('data-test-id') or attrs.get('data-qa')
    if testid and not is_bad_user_text(testid):
        out.append({'strategy':'getByTestId','locator':f"getByTestId('{escape(testid)}')",'confidence':0.98,'risk':'low'})
    label = attrs.get('aria-label') or attrs.get('aria-labelledby')
    name = clean_name(label or attrs.get('title') or text or attrs.get('placeholder') or attrs.get('name') or '')
    if role and name and not is_bad_user_text(name):
        out.append({'strategy':'getByRole','locator':f"getByRole('{role}', {{ name: '{escape(name)}' }})",'confidence':0.92 if role != 'textbox' else 0.91,'risk':'low'})
    if label and not is_bad_user_text(label):
        out.append({'strategy':'getByLabel','locator':f"getByLabel('{escape(label)}')",'confidence':0.93,'risk':'low'})
    ph = attrs.get('placeholder')
    if ph and not is_bad_user_text(ph): out.append({'strategy':'getByPlaceholder','locator':f"getByPlaceholder('{escape(ph)}')",'confidence':0.88,'risk':'medium'})
    if text and not is_bad_user_text(text): out.append({'strategy':'getByText','locator':f"getByText('{escape(text)}')",'confidence':0.72,'risk':'medium'})
    if attrs.get('id') and not re.match(r'^:r\d+:$', attrs['id']): out.append({'strategy':'css-id','locator':f"locator('#{escape_css(attrs['id'])}')",'confidence':0.70,'risk':'medium'})
    return dedupe_candidates(out)

def dedupe_candidates(items):
    seen=set(); out=[]
    for x in items:
        l=x.get('locator')
        if l and l not in seen:
            seen.add(l); out.append(x)
    return out

def escape(s: str) -> str:
    return str(s).replace('\\','\\\\').replace("'","\\'")

def escape_css(s: str) -> str:
    return str(s).replace('\\','\\\\').replace("'","\\'").replace(':','\\:')

def route_from_file(source: Path, p: Path) -> str:
    rp = rel(source, p).replace('\\','/')
    name = Path(rp).stem
    if '/pages/' in '/' + rp or rp.startswith('pages/'):
        x = rp.split('/pages/',1)[-1] if '/pages/' in '/' + rp else rp[len('pages/'):]
        x = re.sub(r'\.(tsx|jsx|ts|js)$','',x)
        x = re.sub(r'/index$','',x)
        return '/' + x.strip('/') if x.strip('/') else '/'
    if '/app/' in '/' + rp or rp.startswith('app/'):
        x = rp.split('/app/',1)[-1] if '/app/' in '/' + rp else rp[len('app/'):]
        x = re.sub(r'/(page|layout)\.(tsx|jsx|ts|js)$','',x)
        return '/' + x.strip('/') if x.strip('/') else '/'
    return '/' + name

def is_page_file(source: Path, p: Path) -> bool:
    rp = rel(source,p).replace('\\','/')
    return '/pages/' in '/' + rp or rp.startswith('pages/') or '/app/' in '/' + rp or rp.startswith('app/') or '/routes/' in '/' + rp or 'Page.' in p.name

def component_kind(source: Path, p: Path, name: str, text: str) -> str:
    rp = rel(source,p).lower()
    n = name.lower()
    if is_page_file(source,p) or n.endswith('page'): return 'route_page'
    if 'dialog' in n or 'modal' in n: return 'dialog'
    if 'form' in n: return 'form_component'
    if 'table' in n or 'grid' in n: return 'table_component'
    if any(x in n for x in ['layout','shell','sidebar','nav','header']): return 'layout'
    if 'components/' in rp: return 'component_scope'
    return 'component'

def extract_components_from_file(source: Path, p: Path) -> List[Dict[str, Any]]:
    text = read_text(p); comps=[]; seen=set()
    names = [m.group(1) for m in EXPORT_RE.finditer(text)]
    if not names:
        names = [m.group(1) for m in COMP_RE.finditer(text)]
    if not names and re.search(r'@Component\s*\(', text):
        names = [pascal(Path(p).stem.replace('.component',''))]
    if not names and '<' in text:
        names = [pascal(Path(p).stem)]
    imports=[]
    for m in IMPORT_RE.finditer(text):
        names_raw = m.group(1) or m.group(2) or ''
        src = m.group(3)
        for nm in [x.strip().split(' as ')[-1].strip() for x in names_raw.split(',') if x.strip()]:
            if nm and nm[:1].isupper(): imports.append({'name':nm,'source':src})
    for nm in names:
        if nm in seen: continue
        seen.add(nm)
        props = sorted(set(re.findall(rf"{re.escape(nm)}\s*\(\s*\{{([^}}]+)\}}", text)))[:20]
        prop_names=[]
        for pstr in props:
            prop_names += [x.strip().split(':')[0].strip() for x in pstr.split(',') if re.match(r'^[A-Za-z_]', x.strip())]
        comps.append({'name':nm,'file':rel(source,p),'framework':framework_for(p),'exports':list(set(names)),'props':sorted(set(prop_names)),'imports':imports,'kind':component_kind(source,p,nm,text),'route':route_from_file(source,p) if is_page_file(source,p) else None})
    return comps

def framework_for(p: Path) -> str:
    e=p.suffix.lower()
    if p.name.endswith('.component.ts') or p.name.endswith('.component.html'): return 'Angular'
    return {'tsx':'React','jsx':'React','.tsx':'React','.jsx':'React','.vue':'Vue','.svelte':'Svelte','.html':'HTML','.ts':'TypeScript'}.get(e,'React')

def extract_elements_from_file(source: Path, p: Path, component: str) -> List[Dict[str,Any]]:
    text = read_text(p); elements=[]; idx=0
    for m in JSX_TAG_RE.finditer(text):
        tag = m.group(1); attrs = parse_attrs(m.group(2) or ''); tag_l=tag.lower()
        if tag_l not in INTERACTIVE_TAGS and not attrs.get('role') and not attrs.get('data-testid') and tag[:1].islower():
            continue
        text_val = nearby_text(text, m.end())
        cands = locator_candidates(tag_l, attrs, text_val)
        if not cands: continue
        idx += 1; line = text[:m.start()].count('\n') + 1
        name = attrs.get('data-testid') or attrs.get('aria-label') or attrs.get('name') or attrs.get('placeholder') or text_val or f'{tag_l}-{idx}'
        elements.append({'name':camel(name),'displayName':clean_name(name),'component':component,'file':rel(source,p),'line':line,'tagName':tag_l,'role':role_for(tag_l,attrs),'type':attrs.get('type',''),'required': 'required' in attrs or attrs.get('aria-required') == 'true','locatorCandidates':cands,'primaryLocator':cands[0]['locator'],'locatorConfidence':cands[0]['confidence'],'locatorRisk':cands[0]['risk'],'attrs':attrs,'text':text_val})
    return elements

def extract_api_deps_from_file(source: Path, p: Path, component: str) -> List[Dict[str,Any]]:
    text=read_text(p); out=[]
    for m in API_CALL_RE.finditer(text):
        method = (m.group(1) or m.group(2) or '').upper() or guess_method_near(text, m.start())
        endpoint=m.group(3)
        out.append({'component':component,'method':method,'endpoint':endpoint,'calledBy':'source-call','file':rel(source,p),'line':text[:m.start()].count('\n')+1,'successState':'success','failureState':'apiError'})
    for m in re.finditer(r'use[A-Za-z0-9_]*(?:Mutation|Query)\s*\(', text):
        out.append({'component':component,'method':'UNKNOWN','endpoint':'UNKNOWN','calledBy':m.group(0).rstrip('('),'file':rel(source,p),'line':text[:m.start()].count('\n')+1,'successState':'success','failureState':'apiError','requiresInference':True})
    return out

def guess_method_near(text, pos):
    window=text[max(0,pos-120):pos+120].lower()
    for m in ['post','put','patch','delete','get']:
        if m in window: return m.upper()
    return 'GET'

def extract_events_from_file(source: Path, p: Path, component: str) -> List[Dict[str,Any]]:
    text=read_text(p); out=[]
    for ev in EVENT_ATTRS:
        for m in re.finditer(ev+r'\s*=\s*(?:\{([^}]+)\}|"([^"]+)"|\'([^\']+)\')', text):
            handler = next((g for g in m.groups() if g), '')
            out.append({'component':component,'event':ev[2:].lower(),'handler':handler[:120],'file':rel(source,p),'line':text[:m.start()].count('\n')+1,'preconditions':[],'expectedResult':'component state updates or side effect is visible'})
    return out

def extract_states_from_text(text: str) -> List[str]:
    states=set(['default'])
    mapping={'loading':'loading','isLoading':'loading','pending':'loading','error':'error','isError':'error','success':'success','disabled':'disabled','readOnly':'read-only','empty':'empty','modal':'modal open','expanded':'expanded','collapsed':'collapsed','selected':'selected','permission':'permission denied','timeout':'network timeout'}
    for token,state in mapping.items():
        if re.search(token, text, re.I): states.add(state)
    if re.search(r'required|invalid|validate|zod|yup|react-hook-form', text, re.I): states.add('validation error')
    return sorted(states)

def extract_validations_from_text(source: Path, p: Path, component: str) -> List[Dict[str,Any]]:
    text=read_text(p); out=[]
    for m in re.finditer(r'(required|minLength|maxLength|pattern|validate|z\.string\(\)\.email|z\.string\(\)\.min|yup\.string\(\)\.email)', text):
        out.append({'component':component,'rule':m.group(1),'field':'unknown','message':'validation rule detected from source','file':rel(source,p),'line':text[:m.start()].count('\n')+1})
    return out

def maturity_score(test: Dict[str,Any]) -> Dict[str,Any]:
    score=0; risks=[]; cov={}
    cov['stableLocators']=bool(test.get('stableLocators')); score += 20 if cov['stableLocators'] else 0
    cov['assertions']=bool(test.get('assertions')); score += 15 if cov['assertions'] else 0
    cov['apiMock']=bool(test.get('apiMocks')); score += 15 if cov['apiMock'] else 0
    cov['negativeCase']=test.get('type') in {'negative','validation','api_error'}; score += 15 if cov['negativeCase'] else 0
    cov['validationCovered']=test.get('type') == 'validation'; score += 10 if cov['validationCovered'] else 0
    cov['stateCovered']=bool(test.get('state')); score += 10 if cov['stateCovered'] else 0
    cov['accessibilityLocatorUsed']=bool(test.get('accessibilityLocatorUsed')); score += 10 if cov['accessibilityLocatorUsed'] else 0
    cov['noHardWaits']=True; score += 5
    if not cov['assertions']: risks.append('missing_assertion')
    if not cov['stableLocators']: risks.append('weak_locator')
    return {'score':min(score,100),'coverage':cov,'risks':risks}
