"""Static UI evidence and QAIra object repository import records."""
from __future__ import annotations
import html
import re
from collections import Counter
from pathlib import PurePosixPath

from qaira_semantic_compiler.qsg.normalization import is_bad_accessible_name
from safe_source import evidence, stable_id, warning
from source_syntax import mask_js, maybe_literal, json_string

UI_EXTENSIONS = {'.jsx', '.tsx', '.html', '.htm', '.vue', '.svelte'}
VOID_TAGS = {'input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'}
ROLES = {'button': 'button', 'select': 'combobox', 'textarea': 'textbox', 'summary': 'button', 'option': 'option'}
INPUT_ROLES = {'text': 'textbox', 'email': 'textbox', 'url': 'textbox', 'tel': 'textbox', 'search': 'searchbox', 'checkbox': 'checkbox', 'radio': 'radio', 'number': 'spinbutton', 'range': 'slider', 'submit': 'button', 'button': 'button', 'reset': 'button'}
# WAI-ARIA 1.2: live-region/status text is content, not an accessible name.
# https://www.w3.org/TR/wai-aria-1.2/#namefromcontent
NAME_FROM_CONTENT = {'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem'}
NAMABLE_ROLES = NAME_FROM_CONTENT | {'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'group', 'img', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'meter', 'navigation', 'note', 'progressbar', 'radiogroup', 'region', 'rowgroup', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tree', 'treegrid'}
LABELABLE_TAGS = {'button', 'input', 'select', 'textarea', 'meter', 'output', 'progress'}
MAX_OBJECTS = 600


def matching_brace(text, start):
    depth = 0
    quote = None
    escape = False
    for i in range(start, min(len(text), start + 20000)):
        ch = text[i]
        if quote:
            if escape: escape = False
            elif ch == '\\': escape = True
            elif ch == quote: quote = None
        elif ch in {'"', "'", '`'}: quote = ch
        elif ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: return i
    return -1


def tag_end(text, start):
    i = start
    quote = None
    while i < min(len(text), start + 20000):
        ch = text[i]
        if quote:
            if ch == quote: quote = None
            elif ch == '\\': i += 1
        elif ch in {'"', "'"}: quote = ch
        elif ch == '{':
            end = matching_brace(text, i)
            if end < 0: return -1
            i = end
        elif ch == '>': return i
        i += 1
    return -1


def attrs(raw):
    result = {}
    dynamic = set()
    pos = 0
    while pos < len(raw):
        while pos < len(raw) and (raw[pos].isspace() or raw[pos] == '/'): pos += 1
        if pos >= len(raw): break
        if raw[pos] == '{':
            end = matching_brace(raw, pos)
            dynamic.add('*')
            pos = end + 1 if end >= 0 else len(raw)
            continue
        match = re.match(r'[A-Za-z_:][\w:.-]*', raw[pos:])
        if not match: pos += 1; continue
        name = match.group(0)
        pos += len(name)
        while pos < len(raw) and raw[pos].isspace(): pos += 1
        if pos >= len(raw) or raw[pos] != '=':
            result[name] = True
            continue
        pos += 1
        while pos < len(raw) and raw[pos].isspace(): pos += 1
        if pos >= len(raw): break
        if raw[pos] in {'"', "'"}:
            quote = raw[pos]
            end = pos + 1
            while end < len(raw):
                if raw[end] == '\\': end += 2
                elif raw[end] == quote: break
                else: end += 1
            value = raw[pos+1:end]
            result[name] = html.unescape(value)
            pos = end + 1
        elif raw[pos] == '{':
            end = matching_brace(raw, pos)
            if end < 0: break
            value = maybe_literal(raw[pos+1:end], None)
            if isinstance(value, (str, bool, int, float)): result[name] = value
            else: dynamic.add(name)
            pos = end + 1
        else:
            match = re.match(r'[^\s/>]+', raw[pos:])
            if match: result[name] = html.unescape(match.group(0)); pos += len(match.group(0))
            else: pos += 1
    return result, dynamic


def static_text(raw):
    parts = []
    dynamic = False
    pos = 0
    while pos < len(raw):
        if raw[pos] == '{':
            end = matching_brace(raw, pos)
            if end < 0: dynamic = True; break
            value = maybe_literal(raw[pos+1:end], None)
            if isinstance(value, str): parts.append(value)
            else: dynamic = True
            pos = end + 1
        else:
            end = raw.find('{', pos)
            if end < 0: end = len(raw)
            parts.append(raw[pos:end])
            pos = end
    return re.sub(r'\s+', ' ', html.unescape(' '.join(parts))).strip(), dynamic


def parse_elements(file):
    text = file['content']
    is_jsx = PurePosixPath(file['path']).suffix.lower() in {'.jsx', '.tsx'}
    searchable = mask_js(text, True) if is_jsx else re.sub(r'<!--[\s\S]*?-->', lambda m: ' ' * len(m.group(0)), text)
    if not is_jsx:
        searchable = re.sub(r'<(?:script|style)\b[^>]*>[\s\S]*?</(?:script|style)\s*>', lambda m: re.sub(r'[^\r\n]', ' ', m.group(0)), searchable, flags=re.I)
    nodes = []
    stack = []
    previous = 0
    cursor = 0
    pattern = re.compile(r'<(/?)([A-Za-z][\w.:-]*)\b')
    while cursor < len(text):
        match = pattern.search(searchable, cursor)
        if not match: break
        end = tag_end(text, match.end())
        if end < 0: break
        if stack and match.start() >= previous:
            raw_text = text[previous:match.start()]
            value, dynamic_text = static_text(raw_text)
            if value: stack[-1]['text_parts'].append(value)
            if dynamic_text: stack[-1]['dynamic_text'] = True
        tag = match.group(2)
        if match.group(1):
            matching = next((i for i in range(len(stack)-1, -1, -1) if stack[i]['tag'].lower() == tag.lower()), None)
            if matching is not None:
                closed = stack[matching:]
                del stack[matching:]
                if stack:
                    for child in closed[:1]:
                        hidden = child['attrs'].get('aria-hidden') in {True, 'true'} or child['attrs'].get('hidden') in {True, 'true'}
                        if not hidden:
                            stack[-1]['text_parts'].extend(child['text_parts'])
                            stack[-1]['dynamic_text'] |= child['dynamic_text'] or bool(child.get('dynamic_names', set()) & {'aria-hidden', 'hidden'})
        else:
            raw_attrs = text[match.end():end]
            values, dynamic = attrs(raw_attrs)
            node = {'tag': tag, 'attrs': values, 'dynamic_attrs': bool(dynamic), 'dynamic_names': dynamic, 'dynamic_text': False, 'text_parts': [], 'offset': match.start(), 'parent': stack[-1] if stack else None}
            nodes.append(node)
            if not raw_attrs.rstrip().endswith('/') and tag.lower() not in VOID_TAGS: stack.append(node)
        previous = end + 1
        cursor = end + 1
        if len(nodes) >= 10000: break
    for node in nodes:
        node['text'] = re.sub(r'\s+', ' ', ' '.join(node['text_parts'])).strip()[:200]
    return nodes


def route_mapping(files):
    mapping = {}
    for file in files:
        if PurePosixPath(file['path']).suffix.lower() not in {'.jsx', '.tsx'}: continue
        text = file['content']
        for match in re.finditer(r'<Route\b', mask_js(text, True)):
            end = tag_end(text, match.end())
            if end < 0: continue
            raw = text[match.end():end]
            values, _ = attrs(raw)
            path = values.get('path')
            component = re.search(r'\belement\s*=\s*\{\s*<([A-Za-z_$][\w$]*)\b', raw)
            if isinstance(path, str) and path.startswith('/') and component:
                mapping.setdefault(component.group(1), set()).add(path)
    return mapping


def page_path(file, mapping):
    path = PurePosixPath(file['path'])
    parts = list(path.parts)
    if 'app' in parts and path.stem == 'page':
        values = [p for p in parts[parts.index('app')+1:-1] if not p.startswith(('(', '@'))]
        if any('[...' in p for p in values): return None
        return '/' + '/'.join(re.sub(r'\[([A-Za-z_][\w]*)\]', r':\1', p) for p in values)
    if 'pages' in parts and 'api' not in parts[parts.index('pages')+1:] and path.stem not in {'_app', '_document', '_error'}:
        values = parts[parts.index('pages')+1:-1] + ([] if path.stem == 'index' else [path.stem])
        # A pages directory also occurs outside Next.js; use explicit React routes first.
        mapped = mapping.get(path.stem)
        if mapped and len(mapped) == 1: return next(iter(mapped))
        if any(file_ in file['content'] for file_ in ('next/router', 'next/navigation', 'next/link')):
            return '/' + '/'.join(re.sub(r'\[([A-Za-z_][\w]*)\]', r':\1', p) for p in values)
    mapped = mapping.get(path.stem)
    if mapped and len(mapped) == 1: return next(iter(mapped))
    return None


def meaningful(value):
    return isinstance(value, str) and 0 < len(value) <= 160 and not is_bad_accessible_name(value) and not re.search(r'[\r\n\x00-\x1f]|\[REDACTED\]', value)


def candidates_for(node, labels):
    a = node['attrs']
    tag = node['tag'].lower()
    native = node['tag'] == tag
    typ = str(a.get('type') or 'text').lower()
    unknown = node.get('dynamic_names', set())
    unknown_role = bool(unknown & {'role', '*', 'type'})
    unknown_name = bool(unknown & {'aria-label', 'aria-labelledby', '*'}) or bool(a.get('aria-labelledby'))
    role = None if unknown_role else a.get('role') or (INPUT_ROLES.get(typ) if tag == 'input' else 'link' if tag == 'a' and a.get('href') else ROLES.get(tag))
    label = labels.get(a.get('id')) if a.get('id') and tag in LABELABLE_TAGS else None
    ancestor = node.get('parent')
    while not label and ancestor and tag in LABELABLE_TAGS:
        if ancestor['tag'].lower() == 'label' and not ancestor['dynamic_text']:
            label = ancestor['text']
            break
        ancestor = ancestor.get('parent')
    text = node['text'] if not node['dynamic_text'] else ''
    content_name = a.get('value') if tag == 'input' and role == 'button' else text if role in NAME_FROM_CONTENT else ''
    name = '' if unknown_name else a.get('aria-label') or label or content_name
    candidates = []
    test_id = a.get('data-testid')
    if meaningful(test_id): candidates.append({'strategy': 'getByTestId', 'locator': 'getByTestId(' + json_string(test_id) + ')', 'confidence': 0.94 if native else 0.72})
    if role in NAMABLE_ROLES and meaningful(name):
        candidates.append({'strategy': 'getByRole', 'locator': 'getByRole(' + json_string(role) + ', { name: ' + json_string(name) + ', exact: true })', 'confidence': 0.89 if native else 0.68})
    if not unknown_name and tag in {'input', 'select', 'textarea'} and meaningful(a.get('aria-label') or label):
        candidates.append({'strategy': 'getByLabel', 'locator': 'getByLabel(' + json_string(a.get('aria-label') or label) + ', { exact: true })', 'confidence': 0.9})
    if tag in {'input', 'textarea'} and meaningful(a.get('placeholder')):
        candidates.append({'strategy': 'getByPlaceholder', 'locator': 'getByPlaceholder(' + json_string(a['placeholder']) + ', { exact: true })', 'confidence': 0.78})
    if meaningful(a.get('id')):
        selector = '[id=' + json_string(a['id']) + ']'
        candidates.append({'strategy': 'css', 'locator': 'locator(' + json_string(selector) + ')', 'confidence': 0.66})
    return candidates, role, name or test_id or a.get('placeholder') or a.get('id') or tag


def generate_objects(files, warnings):
    mapping = route_mapping(files)
    objects = []
    components = []
    unlocated = 0
    ambiguous = 0
    for file in files:
        if PurePosixPath(file['path']).suffix.lower() not in UI_EXTENSIONS or re.search(r'(?:^|/)(?:test|tests|fixtures|__tests__)(?:/|$)|\.(?:test|spec)\.', file['path']): continue
        nodes = parse_elements(file)
        labels = {n['attrs'].get('htmlFor') or n['attrs'].get('for'): n['text'] for n in nodes if n['tag'].lower() == 'label' and not n['dynamic_text'] and n['text']}
        candidates = []
        for node in nodes:
            tag = node['tag'].lower()
            if tag not in {'button', 'input', 'select', 'textarea', 'a', 'summary', 'option'} and not (node['attrs'].get('data-testid') or node['attrs'].get('role')): continue
            choices, role, name = candidates_for(node, labels)
            if not choices: unlocated += 1; continue
            candidates.append((node, choices, role, name))
        counts = Counter(choice['locator'] for _, choices, _, _ in candidates for choice in choices)
        source_name = PurePosixPath(file['path']).stem
        screen_name = source_name if source_name not in {'page', 'index'} else PurePosixPath(file['path']).parent.name or 'Home'
        route = page_path(file, mapping)
        fields = []
        for node, choices, role, name in candidates:
            unique = [c for c in choices if counts[c['locator']] == 1]
            if not unique: ambiguous += 1; continue
            primary = unique[0]
            assumptions = ['Locator is supported by static source evidence and needs browser validation.']
            if not route: assumptions.append('The screen URL could not be established from a literal route declaration.')
            if node['tag'] != node['tag'].lower(): assumptions.append('Confirm this custom component forwards its locator attributes to the DOM.')
            if node['dynamic_attrs']: assumptions.append('Dynamic or spread attributes can alter this element at runtime.')
            field = {
                'id': stable_id('object', file['path'], primary['locator']), 'title': str(name)[:160], 'name': str(name)[:160],
                'screen_name': screen_name, 'record_type': 'field', 'page_url': route or '', 'page_key': file['path'],
                'locator_intent': str(name)[:160], 'locator': primary['locator'], 'locator_kind': primary['strategy'],
                'confidence': primary['confidence'], 'source': 'qaira_repository_agent', 'object_name': str(name)[:160],
                'object_role': str(role or node['tag'].lower()), 'evidence': [evidence(file, node['offset'])],
                'review_required': True, 'assumptions': assumptions,
                'metadata': {
                    'repository_file': file['path'], 'repository_line': evidence(file, node['offset'])['line'],
                    'record_kind': 'field', 'screen_name': screen_name, 'validation_status': 'pending',
                    'fallback_locators': [{'locator': c['locator'], 'strategy': c['strategy'], 'confidenceScore': c['confidence'], 'lastValidatedStatus': 'pending'} for c in unique[1:]],
                    'stability_score': primary['confidence'], 'url_pattern_type': 'exact' if route else 'unknown',
                    'url_pattern_value': route, 'required': node['attrs'].get('required') is True,
                    'input_type': str(node['attrs'].get('type') or ''),
                },
            }
            fields.append(field)
            if len(objects) + len(fields) >= MAX_OBJECTS - 1: break
        if fields:
            objects.append({
                'id': stable_id('screen', file['path']), 'title': screen_name, 'name': screen_name,
                'screen_name': screen_name, 'record_type': 'screen', 'page_url': route or '', 'page_key': file['path'],
                'locator_intent': '__screen__', 'locator': '__screen__', 'locator_kind': 'screen',
                'confidence': 0.88 if route else 0.65, 'source': 'qaira_repository_agent',
                'object_name': '__screen__', 'object_role': 'screen', 'evidence': [evidence(file)], 'review_required': True,
                'metadata': {'record_kind': 'screen', 'screen_name': screen_name, 'repository_file': file['path'], 'url_pattern_type': 'exact' if route else 'unknown', 'url_pattern_value': route},
            })
            objects.extend(fields)
            components.append({'file': file['path'], 'name': screen_name, 'route': route, 'objects': fields, 'evidence': [evidence(file)]})
        if len(objects) >= MAX_OBJECTS:
            warnings.append(warning('object_limit', 'The object preview is limited to 600 records; narrow the source for additional screens.'))
            break
    if unlocated: warnings.append(warning('unresolved_locators', '{} interactive element(s) have no trustworthy static locator and were omitted.'.format(unlocated)))
    if ambiguous: warnings.append(warning('ambiguous_locators', '{} element(s) have duplicate locator candidates within a source file and were omitted.'.format(ambiguous)))
    if not objects: warnings.append(warning('no_static_objects', 'No supported, unambiguous UI locators were found. Provide JSX, TSX or HTML with test IDs, accessible names, labels or stable IDs.'))
    return objects, components
