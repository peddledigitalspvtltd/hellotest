#!/usr/bin/env python3
"""QAIra agent subprocess: source data in, reviewable artifacts out. No repo execution."""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(BASE / 'vendor'))
sys.path.insert(0, str(BASE))

from safe_source import SourceError, MAX_INPUT_BYTES, load_sources, read_regular, warning
from api_agent import discover_contracts, generate_tests
from object_agent import generate_objects
from knowledge_agent import generate_knowledge, generate_component_contracts, component_scaffold

AGENTS = {'object_repository', 'api_tests', 'repository_knowledge', 'component_tests'}
MAX_OUTPUT_BYTES = 6 * 1024 * 1024 - 1024


def compile_payload(payload, progress=None):
    if not isinstance(payload, dict) or payload.get('agent_type') not in AGENTS:
        raise SourceError('Select a supported repository agent.')
    if payload.get('options') is not None and not isinstance(payload['options'], dict):
        raise SourceError('Agent options must be an object.')
    stages = []
    warnings = []

    def stage(id_, label, work):
        initial = {'id': id_, 'label': label, 'status': 'running', 'detail': 'Analyzing the supplied source.', 'duration_ms': 0}
        if progress: progress(initial)
        started = time.monotonic()
        result = work()
        final = dict(initial, status='completed', detail='Stage completed using static source evidence.', duration_ms=round((time.monotonic()-started)*1000))
        stages.append(final)
        if progress: progress(final)
        return result

    files, summary, intake_warnings = stage('source', 'Validate and index source', lambda: load_sources(payload))
    warnings.extend(intake_warnings)
    findings = {'objects': [], 'test_cases': [], 'knowledge': [], 'components': []}
    kind = payload['agent_type']
    if kind in {'api_tests', 'repository_knowledge'}:
        contracts = stage('contracts', 'Discover declared API contracts', lambda: discover_contracts(files, warnings))
        summary['contracts_discovered'] = len(contracts)
        if kind == 'api_tests':
            findings['test_cases'] = stage('generation', 'Build API test drafts', lambda: generate_tests(contracts))
        else:
            warnings[:] = [w for w in warnings if w['code'] != 'no_api_contracts']
            findings['knowledge'] = stage('knowledge', 'Build grounded repository knowledge', lambda: generate_knowledge(files, contracts, warnings))
    else:
        objects, groups = stage('objects', 'Discover screens and reliable locators', lambda: generate_objects(files, warnings))
        if kind == 'object_repository': findings['objects'] = objects
        else:
            findings['components'], findings['test_cases'] = stage('components', 'Build component test contracts', lambda: generate_component_contracts(groups, warnings))
    if kind == 'api_tests':
        warnings.append(warning('static_api_review', 'Generated cases are reviewable drafts. Computed routes, external schema references, router mount prefixes and runtime responses require verification.'))
    if kind in {'object_repository', 'component_tests'}:
        warnings.append(warning('static_ui_review', 'Locators are supported by source evidence. Visibility, uniqueness across composed components and runtime state need browser verification.'))

    def quality():
        for rows in findings.values():
            for row in rows:
                if not row.get('evidence') or not row.get('id') or row.get('review_required') is not True:
                    raise SourceError('An output failed evidence validation.')
        return True
    stage('quality', 'Validate evidence and prepare review', quality)
    unique = []
    seen = set()
    for item in warnings:
        key = (item['code'], item['message'])
        if key not in seen: unique.append(item); seen.add(key)
    summary.update({
        'object_count': len(findings['objects']), 'test_case_count': len(findings['test_cases']),
        'knowledge_count': len(findings['knowledge']), 'component_count': len(findings['components']),
        'analysis_mode': 'deterministic_static', 'runtime_verified': False,
        'review_required': True, 'compiler_version': 'qaira-adapter-1',
    })
    output = {'schema_version': 1, 'agent_type': kind, 'summary': summary, 'warnings': unique, 'findings': findings, 'stages': stages, 'artifacts': []}
    names = {'object_repository': ('object-repository.json', 'objects'), 'api_tests': ('api-test-cases.json', 'test_cases'), 'repository_knowledge': ('repository-knowledge.json', 'knowledge'), 'component_tests': ('component-test-contracts.json', 'components')}
    name, key = names[kind]
    output['artifacts'].append({'name': name, 'mime_type': 'application/json', 'content': json.dumps({'schema_version': 1, 'agent_type': kind, 'review_required': True, 'records': findings[key]}, ensure_ascii=False, separators=(',', ':'))})
    if kind == 'component_tests' and findings['test_cases']:
        output['artifacts'].append({'name': 'component-tests.review.spec.ts', 'mime_type': 'text/plain', 'content': component_scaffold(findings['test_cases'])})
    encoded = json.dumps(output, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > MAX_OUTPUT_BYTES:
        output['artifacts'] = []
        output['warnings'].append(warning('artifact_export_limit', 'The duplicate download artifact was omitted to keep the preview within its 6 MB result limit.'))
    while len(json.dumps(output, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > MAX_OUTPUT_BYTES:
        longest = max(findings, key=lambda k: len(findings[k]))
        if not findings[longest]: raise SourceError('Output cannot fit within its configured limit.')
        del findings[longest][-max(1, len(findings[longest]) // 4):]
        if not any(w['code'] == 'result_limit' for w in output['warnings']):
            output['warnings'].append(warning('result_limit', 'Some findings were omitted to keep the result within 6 MB. Narrow the source for complete coverage.'))
    summary.update({'object_count': len(findings['objects']), 'test_case_count': len(findings['test_cases']), 'knowledge_count': len(findings['knowledge']), 'component_count': len(findings['components'])})
    summary['finding_count'] = sum(len(rows) for rows in findings.values())
    summary['status'] = 'partial' if any(w['code'] not in {'static_api_review', 'static_ui_review'} for w in output['warnings']) or not summary['finding_count'] else 'review_required'
    return output


def main():
    parser = argparse.ArgumentParser(description='Compile bounded repository evidence into QAIra agent drafts.')
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        # Hard limits supplement the parent worker's wall-clock cancellation.
        if sys.platform.startswith('linux'):
            import resource
            def cap_limit(kind, soft, hard):
                current_soft, current_hard = resource.getrlimit(kind)
                if current_hard != resource.RLIM_INFINITY: hard = min(hard, current_hard)
                resource.setrlimit(kind, (min(soft, hard), hard))
            cap_limit(resource.RLIMIT_AS, 512 * 1024 * 1024, 512 * 1024 * 1024)
            cap_limit(resource.RLIMIT_FSIZE, 8 * 1024 * 1024, 8 * 1024 * 1024)
            cap_limit(resource.RLIMIT_CPU, 120, 125)
        raw = read_regular(args.input, MAX_INPUT_BYTES)
        try: payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError, RecursionError) as exc: raise SourceError('Agent input must be valid bounded JSON.') from exc
        def progress(item):
            print(json.dumps({'event': 'stage', 'stage': item}, separators=(',', ':')), flush=True)
        output = compile_payload(payload, progress)
        encoded = json.dumps(output, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0)
        with os.fdopen(os.open(args.output, flags, 0o600), 'wb') as handle:
            handle.write(encoded)
        print(json.dumps({'event': 'completed', 'summary': output['summary']}, separators=(',', ':')), flush=True)
        return 0
    except SourceError as exc:
        print(json.dumps({'event': 'error', 'error': str(exc)}, separators=(',', ':')), file=sys.stderr, flush=True)
        return 2
    except Exception:
        print(json.dumps({'event': 'error', 'error': 'The source could not be analyzed. Check its format and reduce the source scope.'}, separators=(',', ':')), file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
