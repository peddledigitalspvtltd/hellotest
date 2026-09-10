"""Bounded, read-only source ingestion. Repository configuration is never executed."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import unicodedata
import zipfile
from collections import Counter
from pathlib import PurePosixPath

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_SOURCE_BYTES = 40 * 1024 * 1024
MAX_FILE_BYTES = 512 * 1024
MAX_FILES = 3000
MAX_INPUT_BYTES = 64 * 1024 * 1024
SOURCE_EXTENSIONS = {
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.yaml', '.yml',
    '.html', '.htm', '.vue', '.svelte', '.md', '.mdx', '.txt', '.py', '.java',
    '.cs', '.go', '.rb', '.rs', '.sql', '.graphql', '.gql', '.css', '.scss',
    '.php', '.kt', '.swift', '.sh', '.toml', '.xml', '.properties',
}
IGNORED_DIRECTORIES = {
    'node_modules', 'vendor', 'vendors', 'dist', 'build', 'coverage', 'target',
    'generated', 'generated-sources', '__pycache__', '__macosx', 'venv', 'env',
    'site-packages', 'bower_components', 'qaira-output', 'test-results',
    'playwright-report', 'artifacts', 'logs', 'tmp', 'temp',
}
IGNORED_NAMES = {
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
    'composer.lock', 'poetry.lock', 'cargo.lock', 'pipfile.lock',
}
SECRET_NAME = re.compile(r'(?:^|[._-])(?:credentials?|secrets?|passwords?|tokens?|private[._-]?key)(?:[._-]|$)', re.I)


class SourceError(ValueError):
    pass


def stable_id(kind, *parts):
    return kind + '_' + hashlib.sha256('\0'.join(str(p) for p in parts).encode('utf-8')).hexdigest()[:24]


def warning(code, message):
    return {'code': code, 'message': message}


def normalize_path(value):
    if not isinstance(value, str) or not value or len(value) > 500:
        raise SourceError('Source paths must be nonempty strings of at most 500 characters.')
    path = unicodedata.normalize('NFC', value.replace('\\', '/'))
    if path.startswith('/') or re.match(r'^[A-Za-z]:', path) or any(ord(c) < 32 for c in path):
        raise SourceError('Absolute paths, drive paths and control characters are not allowed in source files.')
    parts = path.rstrip('/').split('/')
    if any(p in {'', '.', '..'} for p in parts):
        raise SourceError('Source paths must not contain traversal or empty path segments.')
    return '/'.join(parts)


def skip_reason(path):
    parts = PurePosixPath(path).parts
    lower = [p.lower() for p in parts]
    if any(p.startswith('.') for p in parts):
        return 'hidden_or_secret'
    if any(p in IGNORED_DIRECTORIES for p in lower[:-1]):
        return 'dependency_or_generated'
    name = lower[-1]
    if SECRET_NAME.search(name) or name.endswith(('.pem', '.key', '.p12', '.pfx', '.keystore')):
        return 'hidden_or_secret'
    if name in IGNORED_NAMES or name.endswith(('.min.js', '.min.css', '.map', '.d.ts')):
        return 'dependency_or_generated'
    if PurePosixPath(name).suffix not in SOURCE_EXTENSIONS and name not in {'dockerfile', 'makefile', 'readme', 'license'}:
        return 'unsupported_extension'
    return None


def redact(text):
    text = re.sub(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----', '[REDACTED PRIVATE KEY]', text)
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b', '[REDACTED]', text)
    text = re.sub(r'(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}', r'\1[REDACTED]', text)
    text = re.sub(r'(?i)(https?://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'(?i)([?&](?:access_token|refresh_token|api_key|token|secret|password)=)[^\s&#"\']+', r'\1[REDACTED]', text)
    text = re.sub(r'\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b', '[REDACTED]', text)
    # Quoted secret values are removed while preserving code structure and line numbers.
    pattern = r'''(?i)((?:["']?)(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token|authorization)(?:["']?)\s*[:=]\s*)(["'])([^\r\n]*?)\2'''
    text = re.sub(pattern, lambda m: m.group(1) + m.group(2) + '[REDACTED]' + m.group(2), text)
    return text


def read_regular(path, limit):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, 'rb') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise SourceError('Input must be a regular file within the configured size limit.')
            data = handle.read(limit + 1)
            if len(data) > limit:
                raise SourceError('Input exceeded its size limit while reading.')
            return data
    except (OSError, TypeError) as exc:
        raise SourceError('The server-controlled input file could not be read.') from exc


def load_sources(payload):
    has_files = 'files' in payload
    has_archive = bool(payload.get('archive_path'))
    if has_files == has_archive:
        raise SourceError('Provide exactly one source: files or archive_path.')
    raw = []
    skipped = Counter()
    seen = set()
    total_bytes = 0
    total_candidates = 0
    selected_candidates = 0

    def inspect(path, size):
        nonlocal total_bytes, total_candidates, selected_candidates
        path = normalize_path(path)
        if path in seen:
            raise SourceError('Duplicate normalized source paths are not allowed.')
        seen.add(path)
        total_candidates += 1
        if size < 0:
            raise SourceError('Invalid source file size.')
        reason = skip_reason(path)
        if not reason and size > MAX_FILE_BYTES:
            reason = 'file_too_large'
        if reason:
            skipped[reason] += 1
        else:
            selected_candidates += 1
            total_bytes += size
            if selected_candidates > MAX_FILES:
                raise SourceError('A source may contain at most 3,000 eligible files.')
            if total_bytes > MAX_SOURCE_BYTES:
                raise SourceError('Expanded eligible source exceeds the 40 MB limit.')
        return path, reason

    def append(path, data):
        if b'\x00' in data:
            skipped['binary_or_invalid_utf8'] += 1
            return
        try:
            content = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            skipped['binary_or_invalid_utf8'] += 1
            return
        clean = redact(content)
        if clean != content:
            skipped['files_with_redacted_values'] += 1
        raw.append({'path': path, 'content': clean, 'bytes': len(data)})

    if has_files:
        files = payload['files']
        if not isinstance(files, list) or len(files) > MAX_FILES:
            raise SourceError('files must be an array of at most 3,000 source files.')
        for item in files:
            if not isinstance(item, dict) or not isinstance(item.get('content'), str):
                raise SourceError('Each source file requires a path and text content.')
            data = item['content'].encode('utf-8')
            path, reason = inspect(item.get('path'), len(data))
            if not reason:
                append(path, data)
    else:
        import io
        data = read_regular(payload['archive_path'], MAX_ARCHIVE_BYTES)
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                infos = archive.infolist()
                if len(infos) > MAX_FILES * 2:
                    raise SourceError('Archive contains too many entries.')
                for info in infos:
                    path = normalize_path(info.filename)
                    mode = info.external_attr >> 16
                    if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}):
                        raise SourceError('Symlinks and special files are not allowed in source archives.')
                    if info.flag_bits & 1:
                        raise SourceError('Encrypted source archives are not supported.')
                    if info.is_dir():
                        if path in seen:
                            raise SourceError('Duplicate normalized source paths are not allowed.')
                        seen.add(path)
                        continue
                    if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                        raise SourceError('Only stored or deflated ZIP entries are supported.')
                    path, reason = inspect(path, info.file_size)
                    if reason:
                        continue
                    with archive.open(info) as handle:
                        content = handle.read(MAX_FILE_BYTES + 1)
                    if len(content) != info.file_size or len(content) > MAX_FILE_BYTES:
                        raise SourceError('Archive entry exceeds its declared or permitted size.')
                    append(path, content)
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError) as exc:
            raise SourceError('The source archive is invalid or cannot be read safely.') from exc

    # Remove the conventional enclosing ZIP repository folder, without inventing paths.
    prefix = ''
    if has_archive and raw and all('/' in item['path'] for item in raw):
        roots = {item['path'].split('/')[0] for item in raw}
        if len(roots) == 1:
            prefix = next(iter(roots)) + '/'
            for item in raw:
                item['path'] = item['path'][len(prefix):]
    raw.sort(key=lambda item: item['path'])
    warnings = [warning('source_' + key, '{} file(s): {}.'.format(count, key.replace('_', ' '))) for key, count in sorted(skipped.items())]
    if not raw:
        warnings.append(warning('no_supported_files', 'No supported source files remain after source and secret exclusions.'))
    return raw, {
        'files_scanned': len(raw), 'files_received': total_candidates,
        'files_skipped': sum(v for k, v in skipped.items() if k != 'files_with_redacted_values'),
        'source_bytes': sum(item['bytes'] for item in raw), 'skip_counts': dict(skipped),
        'archive_root_removed': prefix.rstrip('/') or None,
    }, warnings


def evidence(file, offset=0, excerpt=None):
    text = file['content']
    line = text.count('\n', 0, max(0, offset)) + 1
    if excerpt is None:
        lines = text.splitlines()
        excerpt = lines[line - 1] if line <= len(lines) else ''
    return {'path': file['path'], 'line': line, 'excerpt': redact(excerpt)[:240]}
