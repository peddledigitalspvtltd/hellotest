"""Evidence-backed API contracts adapted from the attached compiler's API pipeline."""
from __future__ import annotations
import copy
import json
import re
from pathlib import PurePosixPath

from qaira_semantic_compiler.core.parser import find_matching_paren, split_top_level_args
from qaira_semantic_compiler.core.jsparse import find_matching
from safe_source import evidence, stable_id, warning, redact
from source_syntax import mask_js, maybe_literal

METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options'}
JS_EXTENSIONS = {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'}
MAX_CONTRACTS = 250


def properties(text):
    text = text.strip()
    if not text.startswith('{') or not text.endswith('}'): return {}
    result = {}
    for part in split_top_level_args(text[1:-1]):
        match = re.match(r'''\s*(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])\s*:\s*([\s\S]*)''', part)
        if match: result[match.group(1) or match.group(2)] = match.group(3).strip()
    return result


def resolve_ref(value, document, depth=0, visited=None):
    if depth > 10 or not isinstance(value, dict): return value
    visited = set(visited or [])
    ref = value.get('$ref')
    if ref:
        if not isinstance(ref, str) or not ref.startswith('#/') or ref in visited:
            return {'unresolved_ref': ref}
        node = document
        for part in ref[2:].split('/'):
            part = part.replace('~1', '/').replace('~0', '~')
            if not isinstance(node, dict) or part not in node: return {'unresolved_ref': ref}
            node = node[part]
        return resolve_ref(node, document, depth + 1, visited | {ref})
    return value


def schema_summary(schema, document, depth=0, budget=None):
    budget = [256] if budget is None else budget
    budget[0] -= 1
    if depth > 5 or budget[0] < 0: return {'review_required': True}
    schema = resolve_ref(schema, document)
    if not isinstance(schema, dict): return {}
    result = {key: schema[key][:300] if isinstance(schema[key], str) else schema[key] for key in ('type', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'nullable', 'unresolved_ref') if key in schema and isinstance(schema[key], (str, int, float, bool))}
    if isinstance(schema.get('enum'), list): result['enum'] = [v[:120] if isinstance(v, str) else v for v in schema['enum'][:20] if isinstance(v, (str, int, float, bool)) or v is None]
    if isinstance(schema.get('required'), list): result['required'] = [str(v) for v in schema['required'][:30]]
    if isinstance(schema.get('properties'), dict):
        result['properties'] = {name: schema_summary(item, document, depth + 1, budget) for name, item in list(schema['properties'].items())[:40] if isinstance(name, str) and len(name) <= 120}
    if isinstance(schema.get('items'), dict): result['items'] = schema_summary(schema['items'], document, depth + 1, budget)
    if any(k in schema for k in ('oneOf', 'anyOf', 'allOf')):
        result['review_required'] = True
        result['composition'] = [k for k in ('oneOf', 'anyOf', 'allOf') if k in schema]
    return result


def load_openapi(file, warnings):
    content = file['content']
    if not re.search(r'''["']?\b(?:openapi|swagger)["']?\s*:''', content[:6000]): return None
    extension = PurePosixPath(file['path']).suffix.lower()
    try:
        if extension == '.json':
            document = json.loads(content)
        elif extension in {'.yaml', '.yml'}:
            try: import yaml
            except ImportError:
                warnings.append(warning('yaml_parser_unavailable', 'OpenAPI YAML requires the optional PyYAML runtime; use OpenAPI JSON or install PyYAML.'))
                return None
            class BoundedLoader(yaml.SafeLoader):
                count = 0
                def compose_node(self, parent, index):
                    self.count += 1
                    if self.count > 50000 or self.check_event(yaml.AliasEvent):
                        raise ValueError('YAML aliases or excessive nodes are not supported')
                    return super().compose_node(parent, index)
            document = yaml.load(content, Loader=BoundedLoader)
        else:
            return None
        if not isinstance(document, dict) or not isinstance(document.get('paths'), dict): return None
        # YAML non-JSON scalars and NaN/Infinity cannot enter the application's JSON contract.
        json.dumps(document, allow_nan=False)
        return document
    except Exception:
        warnings.append(warning('invalid_openapi', 'An OpenAPI document could not be parsed safely; its operations were omitted.'))
        return None


def valid_media_type(value):
    return isinstance(value, str) and len(value) <= 200 and bool(re.fullmatch(r'[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:\s*;[^\r\n]+)?', value))


def openapi_contracts(file, document, warnings=None):
    warnings = [] if warnings is None else warnings
    result = []
    for path, raw_item in list(document['paths'].items())[:MAX_CONTRACTS]:
        if not isinstance(path, str) or not path.startswith('/') or len(path) > 500: continue
        item = resolve_ref(raw_item, document)
        if not isinstance(item, dict): continue
        for method, operation in item.items():
            if not isinstance(method, str) or method.lower() not in METHODS or not isinstance(operation, dict): continue
            parameters = []
            common = item.get('parameters') if isinstance(item.get('parameters'), list) else []
            specific = operation.get('parameters') if isinstance(operation.get('parameters'), list) else []
            for raw_parameter in (common + specific)[:60]:
                parameter = resolve_ref(raw_parameter, document)
                if not isinstance(parameter, dict) or parameter.get('in') not in {'path', 'query', 'header', 'cookie', 'body', 'formData'}: continue
                parameters.append({
                    'name': str(parameter.get('name') or '')[:120], 'in': parameter['in'],
                    'required': parameter.get('required') is True or parameter['in'] == 'path',
                    'schema': schema_summary(parameter.get('schema') or parameter, document, budget=[24]),
                })
            merged = {(p['in'], p['name']): p for p in parameters}
            parameters = list(merged.values())
            request_body = resolve_ref(operation.get('requestBody', {}), document)
            body = {}
            body_required = False
            content_type = None
            body_declared = False
            assumptions = ['Documented behavior has not been verified against a running API.']
            if isinstance(request_body, dict):
                content = request_body.get('content') or {}
                if isinstance(content, dict) and content:
                    media_key = 'application/json' if 'application/json' in content else next(iter(content))
                    content_type = media_key if valid_media_type(media_key) else None
                    media = content[media_key]
                    body = schema_summary(media.get('schema', {}), document) if isinstance(media, dict) else {}
                    body_required = request_body.get('required') is True
                    body_declared = True
            legacy_body = False
            for parameter in parameters:
                if parameter['in'] == 'body':
                    body = parameter['schema']
                    body_required = parameter['required']
                    body_declared = legacy_body = True
            form_parameters = [p for p in parameters if p['in'] == 'formData']
            if form_parameters:
                body = {'type': 'object', 'properties': {p['name']: p['schema'] for p in form_parameters}, 'required': [p['name'] for p in form_parameters if p['required']]}
                body_required = any(p['required'] for p in form_parameters)
                body_declared = legacy_body = True
            if legacy_body:
                declared = operation.get('consumes', document.get('consumes', []))
                media_types = [v for v in declared if valid_media_type(v)] if isinstance(declared, list) else []
                content_type = 'application/json' if 'application/json' in media_types else media_types[0] if media_types else None
            media_established = bool(content_type) if body_declared else True
            if body_declared and not media_established:
                assumptions.append('The request body media type is not established by a valid declaration; configure it manually before execution.')
                warnings.append(warning('undeclared_request_media', 'An API request body has no valid content-type declaration. Its media type requires manual review; JSON is not assumed.'))
            statuses = sorted(int(status) for status in (operation.get('responses') or {}) if str(status).isdigit() and 100 <= int(status) <= 599)
            success = [status for status in statuses if 200 <= status < 300]
            offset = content_offset(file['content'], path)
            result.append({
                'id': stable_id('contract', file['path'], method.upper(), path), 'method': method.upper(), 'path': path,
                'title': str(operation.get('summary') or operation.get('operationId') or method.upper() + ' ' + path)[:200],
                'parameters': parameters, 'body': body or None, 'body_required': body_required,
                'content_type': content_type, 'body_media_type_established': media_established,
                'expected_status': success[0] if success else None, 'observed_statuses': statuses,
                'security_required': bool(operation.get('security', document.get('security', []))),
                'evidence': [evidence(file, offset)], 'confidence': 0.96,
                'origin': 'openapi', 'assumptions': assumptions,
            })
            if len(result) >= MAX_CONTRACTS: return result
    return result


def content_offset(content, value):
    match = re.search(r'["\']?' + re.escape(value) + r'["\']?\s*:', content)
    return match.start() if match else 0


def handler_body(raw, full_text):
    value = raw.strip()
    if re.fullmatch(r'[A-Za-z_$][\w$]*', value):
        pattern = r'(?:function\s+' + re.escape(value) + r'\s*\(|(?:const|let)\s+' + re.escape(value) + r'\s*=)'
        match = re.search(pattern, mask_js(full_text, True))
        if match:
            pos = full_text.find('{', match.end())
            end = find_matching(full_text, pos, '{', '}', max_len=MAX_HANDLER) if pos >= 0 else -1
            if end > pos: return full_text[pos:end+1]
    return value


MAX_HANDLER = 60000


def source_contracts(file):
    text = file['content']
    code = mask_js(text, strings=True)
    clean = mask_js(text)
    found = []
    pattern = re.compile(r'\b(app|router|server|fastify)\.(get|post|put|patch|delete|head|options|route)\s*\(', re.I)
    for match in pattern.finditer(code):
        opening = code.find('(', match.start())
        closing = find_matching_paren(clean, opening, max_chars=MAX_HANDLER)
        if closing < 0: continue
        args = split_top_level_args(clean[opening+1:closing])
        if not args: continue
        route_options = {}
        if match.group(2).lower() == 'route':
            route_options = properties(args[0])
            methods = maybe_literal(route_options.get('method', '"GET"'))
            methods = methods if isinstance(methods, list) else [methods]
            path = maybe_literal(route_options.get('url') or route_options.get('path') or '')
            raw_handler = route_options.get('handler', '')
        else:
            methods = [match.group(2).upper()]
            path = maybe_literal(args[0])
            raw_handler = args[-1] if len(args) > 1 else ''
            if len(args) > 2: route_options = properties(args[1])
        if not isinstance(path, str) or not path.startswith('/') or len(path) > 500: continue
        path = re.sub(r':([A-Za-z_][\w]*)', r'{\1}', path)
        handler = handler_body(raw_handler, text)
        for method in methods:
            if not isinstance(method, str) or method.lower() not in METHODS: continue
            found.append(make_source_contract(file, method.upper(), path, handler, match.start(), route_options))
    # App-router exports are accepted only in an actual Next.js route file.
    if PurePosixPath(file['path']).name in {'route.ts', 'route.js', 'route.tsx', 'route.jsx'}:
        parts = list(PurePosixPath(file['path']).parts)
        if 'app' in parts:
            route_parts = [p for p in parts[parts.index('app')+1:-1] if not p.startswith(('(', '@'))]
            path = '/' + '/'.join(route_parts)
            path = re.sub(r'\[([A-Za-z_][\w]*)\]', r'{\1}', path)
            for match in re.finditer(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b', code):
                opening = text.find('{', match.end())
                closing = find_matching(clean, opening, '{', '}', max_len=MAX_HANDLER) if opening >= 0 else -1
                handler = clean[opening:closing+1] if closing > opening else ''
                contract = make_source_contract(file, match.group(1), path, handler, match.start(), {})
                contract['assumptions'] = ['Static route code has not been verified against a running API.']
                if '[...' in path or '[[...' in path:
                    contract['assumptions'].append('Catch-all route parameters require a concrete path before execution.')
                found.append(contract)
    return found


def make_source_contract(file, method, path, handler, offset, options):
    handler_code = mask_js(handler, strings=True)
    params = [{'name': name, 'in': 'path', 'required': True, 'schema': {}} for name in re.findall(r'\{([A-Za-z_][\w]*)\}', path)]
    for name in sorted(set(re.findall(r'\b(?:req|request)\.query(?:\?\.)?\.?(\w+)', handler_code))):
        params.append({'name': name, 'in': 'query', 'required': False, 'schema': {}})
    body = None
    body_required = False
    schema = maybe_literal(options.get('schema', ''), {})
    if isinstance(schema, dict) and isinstance(schema.get('body'), dict):
        body = schema_summary(schema['body'], {})
        body_required = True
    # QAIra/Fastify-style explicit validate({field:{required,type}}, req.body).
    for call in re.finditer(r'\b(?:fastify|app|server)\.validate\s*\(', mask_js(handler, True)):
        opening = handler.find('(', call.start())
        closing = find_matching_paren(handler, opening, max_chars=MAX_HANDLER)
        if closing < 0: continue
        args = split_top_level_args(handler[opening+1:closing])
        declared = maybe_literal(args[0], {}) if args else {}
        if len(args) < 2 or not re.fullmatch(r'(?:req|request)\.body(?:\s*\|\|\s*\{\s*\})?', args[1]) or not isinstance(declared, dict): continue
        properties_ = {}
        required = []
        for name, field in list(declared.items())[:40]:
            if not isinstance(field, dict): continue
            properties_[name] = {'type': field['type']} if field.get('type') in {'string', 'number', 'integer', 'boolean', 'object', 'array'} else {}
            if field.get('required') is True: required.append(name)
        body = {'type': 'object', 'properties': properties_, 'required': required}
        body_required = bool(required)
    if body is None:
        names = sorted(set(re.findall(r'\b(?:req|request)\.body\.([A-Za-z_$][\w$]*)', handler_code)))
        if names: body = {'type': 'object', 'properties': {name: {} for name in names[:40]}, 'required': []}
    statuses = sorted(set(int(v) for v in re.findall(r'\b(?:reply|res|response)\.(?:code|status|sendStatus)\(\s*([1-5]\d{2})\s*\)', handler_code)))
    if isinstance(schema, dict) and isinstance(schema.get('response'), dict):
        statuses = sorted(set(statuses + [int(v) for v in schema['response'] if str(v).isdigit() and 100 <= int(v) <= 599]))
    success = [v for v in statuses if 200 <= v < 300]
    assumptions = ['Verify the router mount prefix, authentication and required data before execution.', 'Static source analysis does not prove runtime behavior.']
    if not success: assumptions.append('No exact success status was declared in the analyzed handler.')
    if not body and re.search(r'\b(?:req|request)\.body\b', handler_code): assumptions.append('The request body is used, but a literal request schema could not be resolved.')
    return {
        'id': stable_id('contract', file['path'], method, path), 'title': method + ' ' + path,
        'method': method, 'path': path, 'parameters': params, 'body': body,
        'body_required': body_required, 'content_type': 'application/json' if body else None,
        'expected_status': success[0] if success else None, 'observed_statuses': statuses,
        'security_required': bool(re.search(r'\b(?:fastify|app|server)\.authenticate\s*\(', handler_code)),
        'evidence': [evidence(file, offset)], 'confidence': 0.8 if body or success else 0.7,
        'origin': 'source', 'assumptions': assumptions,
    }


def discover_contracts(files, warnings):
    documented = []
    source = []
    for file in files:
        ext = PurePosixPath(file['path']).suffix.lower()
        if ext in {'.json', '.yaml', '.yml'}:
            doc = load_openapi(file, warnings)
            if doc: documented.extend(openapi_contracts(file, doc, warnings))
        elif ext in JS_EXTENSIONS and not re.search(r'(?:^|/)(?:test|tests|fixtures|examples|__tests__)(?:/|$)|\.(?:test|spec)\.', file['path'], re.I):
            source.extend(source_contracts(file))
    # A documented operation takes precedence over a matching inferred operation.
    keys = {(c['method'], c['path']) for c in documented}
    contracts = documented + [c for c in source if (c['method'], c['path']) not in keys]
    seen = set()
    unique = []
    for c in contracts:
        key = (c['method'], c['path'], c['evidence'][0]['path'])
        if key not in seen: unique.append(c); seen.add(key)
    if len(unique) > MAX_CONTRACTS:
        warnings.append(warning('contract_limit', 'Only the first 250 API contracts are included; narrow the repository to analyze more.'))
    if not unique:
        warnings.append(warning('no_api_contracts', 'No supported API contracts were found. Supported inputs are OpenAPI JSON/YAML, Express/Fastify literal routes and Next.js app route functions.'))
    return unique[:MAX_CONTRACTS]


def body_template(schema, depth=0):
    if not isinstance(schema, dict) or depth > 5: return None
    if schema.get('properties'):
        return {name: body_template(field, depth+1) if field.get('type') in {'object', 'array'} else '{{' + name + '}}' for name, field in schema['properties'].items()}
    if schema.get('type') == 'array': return []
    if schema.get('type') in {'string', 'number', 'integer', 'boolean'}: return '{{request_body}}'
    return None


def generate_tests(contracts):
    tests = []
    for c in contracts:
        variants = [('positive', None)]
        required = (c.get('body') or {}).get('required') or []
        if required: variants.append(('missing_required_field', required[0]))
        if c['security_required']: variants.append(('authentication', None))
        for kind, field in variants:
            status = c['expected_status'] if kind == 'positive' else next((s for s in c['observed_statuses'] if s in ([401, 403] if kind == 'authentication' else [400, 422])), None)
            body = body_template(c['body'])
            if kind == 'missing_required_field' and isinstance(body, dict): body.pop(field, None)
            label = {'positive': 'valid request', 'missing_required_field': 'missing required ' + str(field), 'authentication': 'missing authentication'}[kind]
            expectation = 'Response status is {} as declared in the contract.'.format(status) if status else 'Compare the response with the approved API contract; no exact status is established by this source.'
            assumptions = list(c['assumptions'])
            if kind != 'positive' and status is None: assumptions.append('The expected rejection status needs review; it was not found in the source.')
            if body is not None: assumptions.append('Replace body placeholders with valid values that respect the declared schema and field types.')
            if kind == 'authentication' and status: assumptions.append('The source declares an authentication response; verify that it applies to missing credentials.')
            tests.append({
                'id': stable_id('api_test', c['id'], kind, field), 'title': c['method'] + ' ' + c['path'] + ' — ' + label,
                'name': c['title'], 'method': c['method'], 'path': c['path'], 'case_kind': kind,
                'parameters': c['parameters'], 'body': body, 'body_schema': c['body'],
                'content_type': c['content_type'], 'body_media_type_established': c.get('body_media_type_established', True), 'expected_status': status,
                'steps': [
                    {'action': 'Prepare the API environment and required test data' + (' without authentication credentials.' if kind == 'authentication' else '.'), 'expected_result': 'Base URL, route parameters and test data are reviewed.'},
                    {'action': 'Send {} {}{}.'.format(c['method'], c['path'], ' without the ' + field + ' body field' if field else ''), 'expected_result': expectation},
                ],
                'assumptions': assumptions, 'evidence': c['evidence'], 'confidence': c['confidence'] if kind == 'positive' else max(0.5, c['confidence'] - 0.1),
                'review_required': True, 'contract_id': c['id'], 'origin': c['origin'],
            })
    return tests
