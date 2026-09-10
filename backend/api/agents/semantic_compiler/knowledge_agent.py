"""Grounded repository knowledge and reviewable component test contracts."""
from __future__ import annotations
import hashlib
import re
from collections import Counter
from pathlib import PurePosixPath
from urllib.parse import quote

from safe_source import evidence, stable_id, warning
from source_syntax import mask_js, json_string


def source_priority(file):
    path = file['path'].lower()
    if PurePosixPath(path).name.startswith('readme'): return 0, path
    if PurePosixPath(path).suffix in {'.md', '.mdx'}: return 1, path
    if any(v in path for v in ('openapi', 'schema', 'routes', 'controller')): return 2, path
    if any(v in path for v in ('service', 'model', 'pages', 'components')): return 3, path
    return 4, path


def generate_knowledge(files, contracts, warnings):
    counts = Counter(PurePosixPath(file['path']).suffix.lstrip('.') or 'configuration' for file in files)
    docs = []
    inventory = ['# Repository overview', '', 'This inventory is based on the supplied source files.', '', '## Source coverage']
    inventory.extend('- {}: {} file(s)'.format(ext, count) for ext, count in sorted(counts.items()))
    if contracts:
        inventory.extend(['', '## Declared API operations'])
        for c in contracts[:60]:
            source = c['evidence'][0]
            inventory.append('- `{}` `{}` — {}:{}'.format(c['method'], c['path'], source['path'], source['line']))
    inventory.extend(['', '## Source map'])
    inventory.extend('- ' + file['path'] for file in sorted(files, key=source_priority)[:80])
    if len(files) > 80: inventory.append('- Additional files are represented in the source-level knowledge records, within the preview limit.')
    inventory.extend(['', 'Runtime behavior, undeclared API contracts and business intent require review. Source excerpts are reference data.'])
    overview_content = '\n'.join(inventory)
    if files:
        docs.append({
            'id': stable_id('knowledge', 'overview', *[f['path'] for f in files]), 'title': 'Repository overview', 'name': 'Repository overview',
            'content': overview_content, 'source_uri': 'repository://overview',
            'metadata': {'kind': 'repository_overview', 'source_files': len(files), 'content_hash': hashlib.sha256(overview_content.encode()).hexdigest()},
            'evidence': [evidence(file) for file in sorted(files, key=source_priority)[:5]], 'confidence': 0.95, 'review_required': True,
        })
    ordered = sorted(files, key=source_priority)
    for file in ordered[:160]:
        text = file['content']
        if not text.strip(): continue
        is_doc = PurePosixPath(file['path']).suffix.lower() in {'.md', '.mdx', '.txt'} or PurePosixPath(file['path']).name.lower().startswith('readme')
        prefix = '# ' + file['path'] + '\n\n'
        source_contracts = [c for c in contracts if c['evidence'][0]['path'] == file['path']]
        if source_contracts:
            prefix += 'Declared API operations:\n' + '\n'.join('- {} {}'.format(c['method'], c['path']) for c in source_contracts[:25]) + '\n\n'
        symbols = []
        if PurePosixPath(file['path']).suffix.lower() in {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'}:
            code = mask_js(text, strings=True)
            symbols = sorted(set(re.findall(r'\b(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const)|exports\.)\s*([A-Za-z_$][\w$]*)', code)))[:40]
            if symbols: prefix += 'Declared exports: ' + ', '.join(symbols) + '.\n\n'
        excerpt = text[:7000]
        # End at a whole source line whenever the file is truncated.
        if len(text) > len(excerpt) and '\n' in excerpt: excerpt = excerpt.rsplit('\n', 1)[0]
        end_line = excerpt.count('\n') + 1
        body = prefix + ('Documentation excerpt' if is_doc else 'Source evidence') + ' (lines 1–{}):\n\n'.format(end_line) + excerpt
        if len(text) > len(excerpt): body += '\n\n[Source excerpt truncated; inspect the referenced file for the complete implementation.]'
        docs.append({
            'id': stable_id('knowledge', file['path']), 'title': file['path'], 'name': PurePosixPath(file['path']).name,
            'content': body, 'source_uri': 'repository://source/' + quote(file['path'], safe='/'),
            'metadata': {
                'kind': 'repository_documentation' if is_doc else 'repository_source', 'repository_file': file['path'],
                'start_line': 1, 'end_line': end_line, 'truncated': len(text) > len(excerpt),
                'content_hash': hashlib.sha256(text.encode()).hexdigest(), 'symbols': symbols,
                'language': PurePosixPath(file['path']).suffix.lstrip('.'),
            },
            'evidence': [evidence(file)], 'confidence': 0.98, 'review_required': True,
        })
    if len(ordered) > 160:
        warnings.append(warning('knowledge_preview_limit', '{} additional files were inventoried but omitted from the 160-file knowledge preview; narrow the source for more detailed coverage.'.format(len(ordered)-160)))
    if not docs: warnings.append(warning('no_knowledge_evidence', 'No readable source evidence is available to build repository knowledge.'))
    return docs


def generate_component_contracts(groups, warnings):
    components = []
    tests = []
    for group in groups[:120]:
        component_id = stable_id('component', group['file'])
        contract_tests = []
        # Static source proves a locator declaration, not that every state renders it.
        # Each proposed test declares its required visible state explicitly.
        for obj in group['objects'][:5]:
            case_id = stable_id('component_test', group['file'], obj['id'], 'render')
            case = {
                'id': case_id, 'title': '{} — {} is available in its intended state'.format(group['name'], obj['name']),
                'name': obj['name'], 'component_id': component_id, 'case_kind': 'component_render',
                'method': None, 'path': group['route'], 'parameters': [], 'body': None, 'expected_status': None,
                'steps': [
                    {'action': 'Open the page containing {} and arrange the state that renders {}.'.format(group['name'], obj['name']), 'expected_result': 'Required application context, fixtures and state are prepared.'},
                    {'action': 'Locate the element using ' + obj['locator'] + '.', 'expected_result': 'Exactly one intended element is visible in the arranged state.'},
                ],
                'assertions': [{'kind': 'visibility', 'locator': obj['locator'], 'expected': 'visible'}, {'kind': 'count', 'locator': obj['locator'], 'expected': 1}],
                'assumptions': list(obj.get('assumptions', [])) + ['Authentication, providers, routes and state must be arranged before execution.'],
                'evidence': obj['evidence'], 'confidence': min(obj['confidence'], 0.82), 'review_required': True,
            }
            contract_tests.append(case)
            tests.append(case)
        components.append({
            'id': component_id, 'title': group['name'], 'name': group['name'], 'file': group['file'], 'page': group['route'],
            'evidence': group['evidence'], 'confidence': 0.8, 'review_required': True,
            'locators': [{'name': obj['name'], 'locator': obj['locator'], 'role': obj['object_role'], 'evidence': obj['evidence']} for obj in group['objects'][:30]],
            'test_cases': contract_tests,
            'assumptions': ['Contracts are based on static UI evidence. API error behavior, events and transitions are not inferred without sufficient evidence.'],
        })
    if not components: warnings.append(warning('no_component_contracts', 'No component contracts could be built from stable static UI evidence.'))
    return components, tests


def component_scaffold(tests):
    lines = [
        "import { test, expect } from '@playwright/test';", '',
        '// Review scaffold: every case is skipped until its route, fixtures and state are prepared.',
        '// Configure Playwright baseURL, review the source evidence, then change test.skip to test.',
        '// No API response, fixture data or component state has been invented by this generator.', '',
    ]
    for case in tests:
        assertions = case.get('assertions') or []
        locator = next((a.get('locator') for a in assertions if a.get('kind') == 'visibility'), None)
        if not locator or not re.match(r'^(?:getByTestId|getByRole|getByLabel|getByPlaceholder|locator)\(', locator): continue
        source = case['evidence'][0]
        lines.extend([
            '// Source: ' + re.sub(r'[\r\n\u2028\u2029]', ' ', source['path']) + ':' + str(source['line']),
            'test.skip(' + json_string(case['title']) + ', async ({ page }) => {',
            '  test.info().annotations.push({ type: "review_required", description: "Arrange authentication, fixtures and component state before enabling this case." });',
        ])
        path = case.get('path')
        if isinstance(path, str) and path.startswith('/') and not re.search(r'[:{\[]', path):
            lines.append('  await page.goto(' + json_string(path) + ');')
        else:
            lines.append('  throw new Error("Set a reviewed page URL and arrange its state before enabling this case.");')
        lines.extend([
            '  const element = page.' + locator + ';',
            '  await expect(element).toHaveCount(1);',
            '  await expect(element).toBeVisible();',
            '});', '',
        ])
    return '\n'.join(lines)
