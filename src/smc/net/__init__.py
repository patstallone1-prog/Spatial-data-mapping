"""Network plumbing shared by every fetch: which certificates to trust."""

from __future__ import annotations

import os


def use_certifi() -> str | None:
    """Point Python's TLS at certifi's bundle when the system's is stale.

    macOS's /etc/ssl/cert.pem lacked the ZeroSSL chain data.sfgov.org serves, so every fetch
    of the city's records failed certificate verification while curl succeeded. certifi's
    bundle is current; setting SSL_CERT_FILE makes the default context use it, in this
    process and in every child. Returns the path, or None when certifi is not installed.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return os.environ["SSL_CERT_FILE"]
    try:
        import certifi
    except ImportError:
        return None
    os.environ["SSL_CERT_FILE"] = certifi.where()
    return certifi.where()
