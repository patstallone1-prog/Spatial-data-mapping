"""Fair private-evidence queues; ranking must not starve another city/provider."""

from __future__ import annotations

from collections import Counter, defaultdict, deque


def evidence_group(item: tuple) -> tuple[str, str]:
    return item[2], item[1]["observation"]["provider"]


def fair_batch(pending: list[tuple], records: list[dict], limit: int,
               focus: dict | None = None) -> list[tuple]:
    """Least-served city/provider first, best-ranked views within each queue.

    This selects work, not source retention. No view or acquisition is deleted.
    History is persisted in the existing review receipts, so restarts are fair too.

    ``focus`` maps ``(region, building_id)`` to a place in line (lower first): the houses a
    focus request names (``build/frontage-supervisor/focus.request.json``,
    scripts/request_frontage_focus.py) are screened before anything else, in that order, every
    provider's view of one together. The rest of the batch is filled fairly as before.
    """
    if focus:
        def place(item):
            return focus.get((item[2], str(item[0]["building_id"])))
        first = sorted((item for item in pending if place(item) is not None),
                       key=lambda item: (place(item), -int(item[1].get("pose_status") == "provider_solved")))
        if first:
            chosen = first[:limit]
            rest = [item for item in pending if place(item) is None]
            return chosen + fair_batch(rest, records, limit - len(chosen))
    served = Counter()
    buildings = Counter()
    seen = set()
    for record in records:
        observation = record.get("candidate", {}).get("observation", {})
        identity = (record.get("region"), record.get("building_id"),
                    observation.get("observation_uid"))
        if identity in seen:
            continue
        seen.add(identity)
        served[(identity[0], observation.get("provider"))] += 1
        buildings[identity[:2]] += 1
    queues = defaultdict(list)
    for item in pending:
        queues[evidence_group(item)].append(item)
    for group, items in queues.items():
        # Serialized ranks contain a capture-date string as well as numbers.
        # Use the selector's native lexicographic ranking, not float coercion.
        items.sort(key=lambda item: tuple(item[1].get("rank", ())), reverse=True)
        items.sort(key=lambda item: (
            buildings[(item[2], item[0]["building_id"])],
            -int(item[1].get("pose_status") == "provider_solved"),
        ))
        queues[group] = deque(items)
    selected = []
    while queues and len(selected) < limit:
        group = min(queues, key=lambda key: (served[key], key))
        selected.append(queues[group].popleft())
        served[group] += 1
        if not queues[group]:
            del queues[group]
    return selected
