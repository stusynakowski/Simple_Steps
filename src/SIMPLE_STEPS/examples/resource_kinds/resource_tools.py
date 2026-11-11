"""
resource_tools.py — one resource of every kind, to try the resource column.

Each type is a deterministic dummy, so every step's output can be checked:

- ``CityDB``      a database      city → region          (bound ``lookup``)
- ``MemoryFS``    a file system   path → text            (bound ``read``, ``size``)
- ``WorkerPool``  compute         squares numbers        (bound ``square``, ``whoami``)
- ``EchoLLM``     a language model                       (bound ``complete``)
- ``WeatherAPI``  a service       city → temperature     (bound ``temperature``)

The column picks each one's icon from its type's name and bases (``DB``,
``FS``, ``Worker``, ``LLM``, ``API``).

``WorkerPool`` refuses ``workers=0`` when it is *built*, not when it is
declared, so it shows the Error status: set its formula to
``WorkerPool(workers=0)`` and press Load. ``whoami`` reports which build of
the pool answered, so Refresh (a new build) is visible when its step re-runs.

    simple-steps run examples/resource_kinds/app.py
    python examples/resource_kinds/runme.py
"""

from __future__ import annotations

import itertools

from SIMPLE_STEPS import Loaded, simple_step_resource, simple_step_tool


@simple_step_resource
class CityDB:
    """A database: an in-memory city → region table."""

    def __init__(self, table: dict | None = None):
        self.table = dict(table or {"SF": "west", "NYC": "east", "LA": "west"})

    @simple_step_tool
    def lookup(self, city: str) -> str:
        """The region stored for a city, or "unknown".

        Args:
            city: the city to look up.
        """
        return self.table.get(city, "unknown")


@simple_step_resource
class MemoryFS:
    """A file system held in memory: path → text."""

    def __init__(self, files: dict | None = None):
        self.files = dict(files or {"readme.txt": "hello", "todo.txt": "load, refresh, clear"})

    @simple_step_tool
    def read(self, path: str) -> str:
        """The text of a file.

        Args:
            path: the file's path.
        """
        if path not in self.files:
            raise FileNotFoundError(f"no file {path!r} (files: {', '.join(sorted(self.files))})")
        return self.files[path]

    @simple_step_tool
    def size(self, path: str) -> int:
        """A file's length in characters.

        Args:
            path: the file's path.
        """
        return len(self.read(path))


_pool_builds = itertools.count(1)


@simple_step_resource
class WorkerPool:
    """Compute: a pool of workers. Refuses to start with fewer than one."""

    def __init__(self, workers: int = 2):
        if workers < 1:
            raise ValueError(f"a pool needs at least one worker, not {workers}")
        self.workers = workers
        self.build = next(_pool_builds)

    @simple_step_tool
    def square(self, x: int) -> int:
        """x squared, computed by the pool.

        Args:
            x: the number to square.
        """
        return x * x

    @simple_step_tool
    def whoami(self) -> str:
        """Which build of the pool this is: a Refresh makes a new one."""
        return f"pool #{self.build}: {self.workers} workers"


@simple_step_resource
class EchoLLM:
    """A language model that answers deterministically: [model] PROMPT."""

    def __init__(self, model: str = "echo-1"):
        self.model = model

    @simple_step_tool
    def complete(self, prompt: str) -> str:
        """One completion for a prompt.

        Args:
            prompt: the text to complete.
        """
        return f"[{self.model}] {prompt.upper()}"


@simple_step_resource
class WeatherAPI:
    """A service: today's temperature for a city (made up, but always the same)."""

    def __init__(self, units: str = "C"):
        if units not in ("C", "F"):
            raise ValueError(f'units must be "C" or "F", not {units!r}')
        self.units = units

    @simple_step_tool
    def temperature(self, city: str) -> float:
        """Today's temperature for a city.

        Args:
            city: the city.
        """
        celsius = 10.0 + sum(map(ord, city)) % 15
        return celsius if self.units == "C" else round(celsius * 9 / 5 + 32, 1)


#: The types users may create in this app.
TYPES = [CityDB, MemoryFS, WorkerPool, EchoLLM, WeatherAPI]


def ready_made() -> dict:
    """What the deployment provides: a shared file system whose files are locked."""
    return {"shared_fs": Loaded(MemoryFS, files={"policy.txt": "read only"}, locked=["files"])}
