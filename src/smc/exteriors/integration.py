"""Opt-in viewer instrumentation; leave the authoritative legacy source/hash untouched."""

from __future__ import annotations

from importlib.resources import files


def instrument_viewer(html: str) -> str:
    """Apply reviewed storefront hooks to a build copy, never edit the source viewer.

    The context checks intentionally fail on an incompatible viewer revision. A future
    renderer refactor must review the adapter rather than silently patching another site.
    """
    patch = files("smc.exteriors").joinpath("viewer.patch").read_text()
    hunks, before, after = [], [], []
    for line in patch.splitlines(keepends=True):
        if line.startswith("@@"):
            if before:
                hunks.append(("".join(before), "".join(after)))
            before, after = [], []
        elif line.startswith(("diff ", "index ", "---", "+++")):
            continue
        elif line == "\n":
            # Empty context lines omit their redundant space in the stored patch.
            before.append(line)
            after.append(line)
        elif line.startswith(" "):
            before.append(line[1:])
            after.append(line[1:])
        elif line.startswith("-"):
            before.append(line[1:])
        elif line.startswith("+"):
            after.append(line[1:])
    if before:
        hunks.append(("".join(before), "".join(after)))
    if not hunks:
        raise ValueError("exterior integration patch is empty")
    for old, new in hunks:
        if html.count(old) != 1:
            raise ValueError("viewer revision differs; review storefront integration context")
        html = html.replace(old, new, 1)
    return html
