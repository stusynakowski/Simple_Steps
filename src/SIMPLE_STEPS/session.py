"""
Cookie-bound session identity for Simple Steps.
================================================

A *session* is the unit of isolation between concurrent users / browser
tabs / desktop windows that connect to the same backend process.  Each
session gets:

  • Its own bucket in :data:`SIMPLE_STEPS.engine.DATA_STORE`
  • Its own progress trackers in :data:`SIMPLE_STEPS.progress._active`
  • Its own parquet cache subdirectory under
    ``SIMPLE_STEPS_RESULT_CACHE_DIR/<session_token>/``

The session ID is minted server-side on first contact and stored in an
``HttpOnly`` cookie.  The frontend NEVER sees, sends, or constructs it —
the browser just carries the cookie on every request.  This means:

  • Two browser tabs of the same workflow get distinct sessions (the
    cookie is shared so they actually share state — that's a feature for
    "open the same pipeline in two windows").  If you want them isolated,
    use an incognito / private window.
  • Two different humans on different machines get distinct cookies →
    distinct sessions → no cross-talk.
  • A pipeline file (workflow ID) is no longer conflated with a session.
    The same saved pipeline can be run by many users in parallel without
    their results stomping on each other.

Use the :func:`get_session_id` FastAPI dependency on any endpoint that
touches session-scoped state (``/api/run``, ``/api/data``,
``/api/progress``, …)::

    from fastapi import Depends
    from .session import get_session_id

    @app.post("/api/run")
    async def execute_step(payload: StepRunRequest,
                           session_id: str = Depends(get_session_id)):
        ...
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Request, Response, WebSocket


SESSION_COOKIE_NAME = "ss_session"

# 30 days.  Long enough that returning users keep their data refs across
# normal browser restarts; short enough that abandoned tabs eventually
# free their server-side caches when re-opened.
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30


def _mint_session_id() -> str:
    """Generate a new opaque session identifier (32 hex chars)."""
    return uuid.uuid4().hex


def get_session_id(request: Request, response: Response) -> str:
    """
    FastAPI dependency that returns the caller's session ID.

    Reads ``ss_session`` from the request cookie if present; otherwise
    mints a new one and sets it on the response.  The cookie is
    ``HttpOnly`` so client-side JavaScript cannot read or spoof it.

    The dependency mutates the response object in place (sets the
    cookie header).  FastAPI merges those headers onto whatever the
    route handler ultimately returns, so this works for plain return
    values, ``Response`` subclasses, and ``StreamingResponse`` alike.
    """
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if sid:
        return sid

    sid = _mint_session_id()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        # We do not assume HTTPS in local / desktop modes; the cookie is
        # only meaningful within the local origin anyway.  Anyone hosting
        # Simple Steps publicly should put it behind a reverse proxy and
        # set this to True via configuration (out of scope for P0).
        secure=False,
        path="/",
    )
    return sid


def get_session_id_ws(websocket: WebSocket) -> Optional[str]:
    """
    Read the session cookie off a WebSocket handshake.

    WebSockets cannot mint a new cookie (no ``Set-Cookie`` response
    header on the upgrade), so callers that hit a WS without a session
    cookie should close with policy code ``1008`` and instruct the
    client to make any HTTP request first to obtain a session.

    Returns ``None`` if the cookie is missing.
    """
    return websocket.cookies.get(SESSION_COOKIE_NAME) or None
