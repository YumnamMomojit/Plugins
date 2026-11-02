"""browser-use runner for the Semdok Browser plugin.

    bu_runner.py setup <home>        prepare <home>/venv with browser-use (any Python 3.11+ can run this)
    bu_runner.py run <home> <json>   run one browsing task with the venv's Python; <json> holds the request

The Semdok key arrives in SEMDOK_BROWSER_API_KEY and is never written to disk. Progress lines start with
"BU_PROGRESS ", the result with "BU_RESULT ".
"""
import asyncio
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

BROWSER_USE = 'browser-use==0.13.14'
# Windows on Arm has no build of cryptography (a browser-use dependency), so there the environment runs on
# x64 CPython under Windows' x64 emulation, the build Semdok Harness ships for x64 Windows.
X64_PYTHON = {
    'url': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/'
           'cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    'sha256': '7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14',
}
STAMP = 'ready.json'
# Seconds: pause before reading each page, longest wait for the page to finish loading, pause between actions.
PACES = {
    'fast': (0.0, 0.0, 0.1),
    'human': (1.5, 10.0, 1.0),
    'patient': (3.0, 20.0, 2.0),
}


def progress(message):
    print(f'BU_PROGRESS {message}', flush=True)


def venv_python(home):
    return home / 'venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def base_python(home):
    if sys.platform == 'win32' and platform.machine().upper() in ('ARM64', 'AARCH64'):
        exe = home / 'python-x64' / 'python' / 'python.exe'
        if not exe.exists():
            progress('Downloading Python (x64 build for Windows on Arm)...')
            archive = home / 'python-x64.tar.gz'
            with urllib.request.urlopen(X64_PYTHON['url'], timeout=300) as response, open(archive, 'wb') as out:
                shutil.copyfileobj(response, out)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != X64_PYTHON['sha256']:
                archive.unlink()
                raise RuntimeError('downloaded Python failed its checksum check')
            shutil.rmtree(home / 'python-x64', ignore_errors=True)
            with tarfile.open(archive) as tar:
                tar.extractall(home / 'python-x64', filter='data')
            archive.unlink()
        return exe
    return Path(sys.executable)


def setup(home):
    home.mkdir(parents=True, exist_ok=True)
    stamp = home / STAMP
    if stamp.exists() and json.loads(stamp.read_text()).get('package') == BROWSER_USE and venv_python(home).exists():
        progress('browser-use is already installed.')
        return
    base = base_python(home)
    progress('Creating the Python environment...')
    shutil.rmtree(home / 'venv', ignore_errors=True)
    subprocess.run([str(base), '-m', 'venv', str(home / 'venv')], check=True)
    py = str(venv_python(home))
    progress('Installing browser-use (about 300 MB, first time only)...')
    subprocess.run([py, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-q', '--only-binary=:all:',
                    BROWSER_USE], check=True)
    subprocess.run([py, '-c', 'import browser_use'], check=True, env=quiet_env())
    stamp.write_text(json.dumps({'package': BROWSER_USE}))
    progress('browser-use is installed.')


def quiet_env():
    # No anonymous telemetry and no cloud sync: the plugin talks only to Semdok and the sites being browsed.
    return {**os.environ, 'ANONYMIZED_TELEMETRY': 'false', 'BROWSER_USE_CLOUD_SYNC': 'false',
            'BROWSER_USE_LOGGING_LEVEL': 'result', 'PYTHONUTF8': '1'}


def find_browser(configured):
    candidates = [configured] if configured else []
    if sys.platform == 'win32':
        for base in (os.environ.get('PROGRAMFILES', r'C:\Program Files'), os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'),
                     os.environ.get('LOCALAPPDATA', '')):
            candidates += [rf'{base}\Google\Chrome\Application\chrome.exe', rf'{base}\Microsoft\Edge\Application\msedge.exe']
    elif sys.platform == 'darwin':
        candidates += ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    else:
        candidates += [shutil.which(name) for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge')]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(candidate)
    raise RuntimeError('No Chrome, Edge or Chromium was found. Install Google Chrome or set browserPath in the plugin settings.')


async def browse(request):
    from browser_use import Agent, BrowserProfile, BrowserSession, ChatOpenAI

    load, idle, between = PACES.get(request.get('pace', 'human'), PACES['human'])
    profile_dir = tempfile.mkdtemp(prefix='semdok-browser-')   # a fresh browser profile: no cookies or logins of the user
    try:
        profile = BrowserProfile(
            executable_path=find_browser(request.get('browser_path')),
            headless=not request.get('show_browser', True),
            user_data_dir=profile_dir,
            minimum_wait_page_load_time=load,
            wait_for_network_idle_page_load_time=idle,
            wait_between_actions=between,
            keep_alive=False,
        )
        llm = ChatOpenAI(model=request['model'], base_url=request['base_url'], api_key=os.environ['SEMDOK_BROWSER_API_KEY'])
        task = request['task']
        if request.get('start_url'):
            task = f'Start at {request["start_url"]}. {task}'
        agent = Agent(task=task, llm=llm, browser_session=BrowserSession(browser_profile=profile),
                      use_vision=request.get('use_vision', True), max_failures=3,
                      extend_system_message=request.get('rules', ''))

        async def on_step_start(running):
            # browser-use reads the page almost at once; a person waits for it to finish loading and then looks
            # for a moment, which also gives late, script-filled content time to appear.
            if load <= 0:
                return
            try:
                cdp = await running.browser_session.get_or_create_cdp_session(focus=True)
                deadline = asyncio.get_running_loop().time() + idle
                while asyncio.get_running_loop().time() < deadline:
                    state = await cdp.cdp_client.send.Runtime.evaluate(
                        params={'expression': 'document.readyState', 'returnByValue': True}, session_id=cdp.session_id)
                    if state.get('result', {}).get('value') == 'complete':
                        break
                    await asyncio.sleep(0.2)
            except Exception:
                pass   # no page yet (first step) or the tab is changing: just use the pause below
            await asyncio.sleep(load)

        async def on_step_end(running):
            steps = running.state.n_steps
            progress(f'Step {steps}: {(running.state.last_model_output.next_goal if running.state.last_model_output else "")[:160]}')

        history = await agent.run(max_steps=int(request.get('max_steps', 25)), on_step_start=on_step_start, on_step_end=on_step_end)
        return {
            'done': history.is_done(),
            'success': history.is_successful(),
            'result': history.final_result() or '',
            'steps': history.number_of_steps(),
            'seconds': round(history.total_duration_seconds(), 1),
            'urls': [url for url in dict.fromkeys(history.urls()) if url and url != 'about:blank'][:20],
            'errors': [error for error in history.errors() if error][-3:],
        }
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)


def main():
    command, home = sys.argv[1], Path(sys.argv[2])
    if command == 'setup':
        setup(home)
        return
    if command == 'run':
        argument = sys.argv[3]
        request = json.loads(Path(argument[1:]).read_text(encoding='utf-8') if argument.startswith('@') else argument)
        os.environ.update(quiet_env())
        print('BU_RESULT ' + json.dumps(asyncio.run(browse(request))), flush=True)
        return
    raise SystemExit(f'unknown command {command}')


if __name__ == '__main__':
    main()
