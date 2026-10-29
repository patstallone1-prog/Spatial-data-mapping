"""Bounded, request-local memoization for immutable geometry calculations.

A nested apartment solve shares the parent's cache. A new inference starts fresh,
so worker lifetime, unrelated buildings and concurrent requests cannot share state.
Validation still runs against the actual serialized output on every inference.
"""

from __future__ import annotations

from contextvars import ContextVar
from functools import wraps

_ACTIVE: ContextVar[dict | None] = ContextVar("interior_geometry_memo", default=None)
MAX_ENTRIES_PER_FUNCTION = 4096


def geometry_cached(function=None, *, limit=MAX_ENTRIES_PER_FUNCTION):
    if function is None:
        return lambda decorated: geometry_cached(decorated, limit=limit)

    @wraps(function)
    def cached(*args, **kwargs):
        session = _ACTIVE.get()
        if session is None:
            return function(*args, **kwargs)
        cache = session.setdefault(function, {})
        key = (args, tuple(kwargs.items()))
        if key in cache:
            return cache[key]
        result = function(*args, **kwargs)
        if len(cache) >= limit:
            del cache[next(iter(cache))]
        cache[key] = result
        return result

    return cached


def inference_session(function):
    @wraps(function)
    def solve(*args, **kwargs):
        if _ACTIVE.get() is not None:
            return function(*args, **kwargs)
        token = _ACTIVE.set({})
        try:
            return function(*args, **kwargs)
        finally:
            _ACTIVE.reset(token)

    return solve
