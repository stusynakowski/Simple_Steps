"""
Lightweight progress reporting for long-running step executions.

Uses a thread-local + dict approach so that any orchestrator can report
progress and an SSE endpoint can stream it to the frontend.
"""
import threading
import time
from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from queue import Queue, Empty


@dataclass
class StepProgress:
    """Tracks progress for a single running step."""
    step_id: str
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


# Global registry of active step progress trackers
_active: Dict[str, StepProgress] = {}
_lock = threading.Lock()


def start_progress(step_id: str) -> StepProgress:
    prog = StepProgress(step_id=step_id)
    with _lock:
        _active[step_id] = prog
    return prog


def get_progress(step_id: str) -> Optional[StepProgress]:
    with _lock:
        return _active.get(step_id)


def end_progress(step_id: str):
    with _lock:
        prog = _active.pop(step_id, None)
        if prog:
            prog.finish()
