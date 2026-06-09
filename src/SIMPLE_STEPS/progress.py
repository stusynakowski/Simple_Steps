"""
Lightweight progress reporting for long-running step executions.

Trackers are scoped by ``(session_id, step_id)`` so concurrent users do
not see each other's progress streams.  Any orchestrator that wants to
report progress should call :func:`start_progress` at the beginning of a
run, ``prog.update(...)`` periodically, and :func:`end_progress` when
done (typically in a ``finally`` block).
"""
import threading
import time
from typing import Optional, Dict
from dataclasses import dataclass, field
from queue import Queue


@dataclass
class StepProgress:
    """Tracks progress for a single running step within one session."""
    step_id: str
    session_id: str
    total: int = 0
    current: int = 0
    message: str = ""
    started_at: float = field(default_factory=time.time)
    queue: Queue = field(default_factory=Queue)  # SSE listeners pull from here

    def update(self, current: int, total: int, message: str = ""):
        self.current = current
        self.total = total
        self.message = message
        # Push event to queue (non-blocking) for SSE consumers
        self.queue.put({
            "current": current,
            "total": total,
            "message": message,
            "elapsed": round(time.time() - self.started_at, 1),
        })

    def finish(self):
        """Signal completion to any SSE listener."""
        self.queue.put(None)  # sentinel


# session_id → step_id → StepProgress
_active: Dict[str, Dict[str, StepProgress]] = {}
_lock = threading.Lock()


def start_progress(session_id: str, step_id: str) -> StepProgress:
    """Register a new progress tracker for ``step_id`` under ``session_id``."""
    prog = StepProgress(step_id=step_id, session_id=session_id)
    with _lock:
        _active.setdefault(session_id, {})[step_id] = prog
    return prog


def get_progress(session_id: str, step_id: str) -> Optional[StepProgress]:
    """Return the live tracker for ``step_id`` within ``session_id``, or None."""
    with _lock:
        bucket = _active.get(session_id)
        return bucket.get(step_id) if bucket else None


def end_progress(session_id: str, step_id: str) -> None:
    """Mark the tracker complete and remove it from the registry."""
    with _lock:
        bucket = _active.get(session_id)
        if not bucket:
            return
        prog = bucket.pop(step_id, None)
        if prog:
            prog.finish()
        # Garbage-collect the empty session bucket so long-lived servers
        # don't accumulate one entry per ever-seen session.
        if not bucket:
            _active.pop(session_id, None)


def clear_session(session_id: str) -> None:
    """
    Drop all progress trackers for a session — useful when a session is
    invalidated or its WebSocket disconnects with no in-flight work.
    """
    with _lock:
        bucket = _active.pop(session_id, None)
        if not bucket:
            return
        for prog in bucket.values():
            prog.finish()
