"""TradingAgents runner for the Semdok Harness plugin.

    ta_runner.py setup <home>      prepare <home>/venv with TradingAgents (any Python 3.11+ can run this)
    ta_runner.py run <home> <json> analyze one ticker with the venv's Python; <json> holds the request

The Semdok key arrives in OPENAI_COMPATIBLE_API_KEY and the gateway in TA_BACKEND_URL;
neither is written to disk. Progress lines start with "TA_PROGRESS ", the result with "TA_RESULT ".
"""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

TRADINGAGENTS_COMMIT = 'e8f5503e9b86d5c2710b0c76b1f686703968c9df'
TRADINGAGENTS_SOURCE = f'https://github.com/TauricResearch/TradingAgents/archive/{TRADINGAGENTS_COMMIT}.zip'
# Windows on Arm has no build of tiktoken (needed by langchain-openai), so there the
# environment runs on x64 CPython under Windows' x64 emulation, the build Semdok
# Harness ships for x64 Windows.
X64_PYTHON = {
    'url': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/'
           'cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    'sha256': '7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14',
}
SKIPPED = 'langgraph-checkpoint-sqlite'   # pulls sqlite-vec for the resume feature, which the plugin never enables
STAMP = 'ready.json'


def progress(message):
    print(f'TA_PROGRESS {message}', flush=True)


def venv_python(home):
    return home / 'venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def base_python(home):
    if sys.platform == 'win32' and platform.machine().upper() in ('ARM64', 'AARCH64'):
        target = home / 'python-x64'
        exe = target / 'python' / 'python.exe'
        if not exe.exists():
            progress('Downloading Python (x64 build for Windows on Arm)...')
            archive = home / 'python-x64.tar.gz'
            with urllib.request.urlopen(X64_PYTHON['url'], timeout=300) as response, open(archive, 'wb') as out:
                shutil.copyfileobj(response, out)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if digest != X64_PYTHON['sha256']:
                archive.unlink()
                raise RuntimeError('downloaded Python failed its checksum check')
            shutil.rmtree(target, ignore_errors=True)
            with tarfile.open(archive) as tar:
                tar.extractall(target, filter='data')
            archive.unlink()
        return exe
    return Path(sys.executable)


def setup(home):
    home.mkdir(parents=True, exist_ok=True)
    stamp = home / STAMP
    if stamp.exists() and json.loads(stamp.read_text())['commit'] == TRADINGAGENTS_COMMIT and venv_python(home).exists():
        progress('TradingAgents is already installed.')
        return
    base = base_python(home)
    progress('Creating the Python environment...')
    shutil.rmtree(home / 'venv', ignore_errors=True)
    subprocess.run([str(base), '-m', 'venv', str(home / 'venv')], check=True)
    py = str(venv_python(home))

    def pip(*args):
        subprocess.run([py, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-q', *args], check=True)

    progress('Installing TradingAgents and its libraries (a few minutes, first time only)...')
    pip('--no-deps', TRADINGAGENTS_SOURCE)
    requirements = json.loads(subprocess.run(
        [py, '-c', 'import importlib.metadata, json; print(json.dumps(importlib.metadata.requires("tradingagents")))'],
        check=True, capture_output=True, text=True).stdout)
    keep = [r for r in requirements if 'extra ==' not in r
            and r.split(';')[0].replace(' ', '').lower().split('>')[0].split('<')[0].split('=')[0].split('[')[0] != SKIPPED]
    pip(*keep)
    pip('--no-deps', 'langgraph-checkpoint-sqlite>=3.1.1')
    pip('aiosqlite>=0.20')
    subprocess.run([py, '-c', 'import tradingagents.graph.trading_graph'], check=True)
    stamp.write_text(json.dumps({'commit': TRADINGAGENTS_COMMIT}))
    progress('TradingAgents is installed.')


DEPTH = {'quick': (1, 1), 'standard': (2, 2), 'deep': (3, 3)}


def run(home, request):
    from tradingagents.default_config import build_default_config
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.reporting import write_report_tree

    config = build_default_config()
    rounds = DEPTH[request.get('depth', 'quick')]
    config.update({
        'llm_provider': 'openai_compatible',
        'backend_url': os.environ['TA_BACKEND_URL'],
        'deep_think_llm': request['deep_model'],
        'quick_think_llm': request['quick_model'],
        'max_debate_rounds': rounds[0],
        'max_risk_discuss_rounds': rounds[1],
        'output_language': request.get('language', 'English'),
        'results_dir': str(home / 'logs'),
        'data_cache_dir': str(home / 'cache'),
        'memory_log_path': str(home / 'memory' / 'trading_memory.md'),
        'checkpoint_enabled': False,
        'llm_max_retries': 4,
    })
    analysts = request.get('analysts') or ['market', 'social', 'news', 'fundamentals']
    progress(f"Analyzing {request['ticker']} for {request['date']} with {', '.join(analysts)} analysts...")
    graph = TradingAgentsGraph(selected_analysts=analysts, debug=False, config=config)
    final_state, rating = graph.propagate(request['ticker'], request['date'], asset_type=request.get('asset_type', 'stock'))
    out = Path(request['out_dir'])
    report = write_report_tree(final_state, request['ticker'], out, graph.run_settings())
    print('TA_RESULT ' + json.dumps({
        'rating': rating,
        'report': str(report),
        'html': str(out / 'complete_report.html'),
        'decision': (final_state.get('final_trade_decision') or '')[:4000],
    }), flush=True)


if __name__ == '__main__':
    command, home = sys.argv[1], Path(sys.argv[2])
    if command == 'setup':
        setup(home)
    elif command == 'run':
        raw = sys.argv[3]
        run(home, json.loads(Path(raw[1:]).read_text(encoding='utf-8') if raw.startswith('@') else raw))
    else:
        raise SystemExit(f'unknown command {command}')
