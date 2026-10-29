"""Fork server for the native guest simulators. No VM or credentials are used.

Each request still runs in a fresh process: the server forks a child that runs
the guest exactly as `python3 -I -S <guest> <args...>` with the program on
stdin would. The server only imports the standard library once, so a request
no longer pays for interpreter start-up. Requests run one at a time, in order,
as they did when each one blocked the test process.
"""
import sys, os, io, json, runpy, tempfile, traceback
# What the guests and the transported management programs import.
import base64, contextlib, fcntl, hashlib, pathlib, re, select, selectors, shutil
import signal, socket, stat, subprocess, threading, time, types, uuid

# The test process holds the other ends; when it exits, the server does.
requests = open(sys.argv[1], "rb")
responses = open(sys.argv[2], "wb")


def child(request, program, output):
    code = 1
    try:
        # The child never uses the server's pipes: stdin is at end of file once
        # the program is read, and stdout is a private file.
        os.dup2(os.open(os.devnull, os.O_RDWR), 0)
        os.dup2(output.fileno(), 1)
        os.dup2(os.open(os.devnull, os.O_WRONLY), 2)
        os.chdir(request["cwd"])
        os.environ.clear()
        os.environ.update(request["env"])
        sys.argv = [request["guest"], *request["args"]]
        sys.stdin = io.StringIO(program)
        sys.stdout = sys.__stdout__ = open(1, "w", closefd=False)
        sys.stderr = sys.__stderr__ = open(2, "w", closefd=False)
        try:
            runpy.run_path(request["guest"], run_name="__main__")
            code = 0
        except SystemExit as exit:
            code = exit.code if isinstance(exit.code, int) else 0 if exit.code is None else 1
        except BaseException:
            traceback.print_exc()
    finally:
        # Leave through normal interpreter shutdown, as a started process would.
        raise SystemExit(code)


while True:
    header = requests.readline()
    if not header:
        break
    request = json.loads(header)
    program = requests.read(request["size"]).decode()
    with tempfile.TemporaryFile() as output:
        pid = os.fork()
        if pid == 0:
            child(request, program, output)
        _, status = os.waitpid(pid, 0)
        output.seek(0)
        stdout = output.read()
    responses.write(json.dumps({"status": os.waitstatus_to_exitcode(status), "size": len(stdout)}).encode() + b"\n" + stdout)
    responses.flush()
