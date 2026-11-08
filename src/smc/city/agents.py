"""Things moving through the streets: people walking, vehicles driving, at lawful speeds.

An agent follows a route of graph nodes. A walker goes at a walking pace; a vehicle at the
speed limit the law sets for each street's class, slowed by how many other vehicles share the
street (a volume/capacity curve) -- lightweight route-following, not physics, which is what lets
a district keep dozens of cars moving near each player. Each step reports who arrived.

Only agents near a player move here. The rest of the population is simulated by schedule
(``smc.city.npc``) and travels in the time a trip would take without being stepped.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

from smc.city.streets import WALK_MS, StreetGraph

#: Vehicles a street of each class carries before it slows, per edge (a block's worth of lane).
CAPACITY = {"motorway": 40, "arterial": 18, "residential": 8, "service": 3, "shared": 4}


def congestion_factor(volume: int, capacity: int) -> float:
    """Free-flow speed multiplier for so many vehicles on an edge (the BPR curve, inverted)."""
    return 1.0 / (1.0 + 0.15 * (volume / max(1, capacity)) ** 4)


@dataclass
class Agent:
    id: str
    mode: str  # walk | drive
    route: list[int]
    #: index of the edge being travelled (route[leg] -> route[leg + 1]) and metres along it
    leg: int = 0
    along_m: float = 0.0
    #: the vehicle asset being driven, if any
    vehicle: str | None = None
    #: a ceiling of its own under the speed limit (a bus, a cautious driver); None: the limit
    cruise_ms: float | None = None
    #: how far over the limit it is driven (1.0: at it). Speed cameras exist for the rest.
    excess: float = 1.0
    #: the model, for traffic that is not in the property records (through traffic)
    model: str | None = None
    done: bool = False
    travelled_m: float = 0.0

    def position(self, graph: StreetGraph) -> tuple[float, float]:
        if self.done or self.leg >= len(self.route) - 1:
            return graph.xy[self.route[-1]]
        (ax, ay), (bx, by) = graph.xy[self.route[self.leg]], graph.xy[self.route[self.leg + 1]]
        length = math.hypot(bx - ax, by - ay) or 1.0
        t = min(1.0, self.along_m / length)
        return (ax + (bx - ax) * t, ay + (by - ay) * t)


@dataclass
class Movement:
    graph: StreetGraph
    #: road class -> lawful speed in m/s, asked of the law book for where and when this is
    speed_limit: dict[str, float]
    agents: dict[str, Agent] = field(default_factory=dict)

    def add(self, agent: Agent) -> Agent:
        if len(agent.route) < 1:
            raise ValueError("an agent needs a route")
        self.agents[agent.id] = agent
        return agent

    def remove(self, agent_id: str) -> None:
        self.agents.pop(agent_id, None)

    def volumes(self) -> Counter:
        load: Counter = Counter()
        for a in self.agents.values():
            if a.mode == "drive" and not a.done and a.leg < len(a.route) - 1:
                load[(a.route[a.leg], a.route[a.leg + 1])] += 1
        return load

    def speed(self, agent: Agent, road_class: str, volume: int) -> float:
        if agent.mode == "walk":
            return WALK_MS
        lawful = self.speed_limit.get(road_class, 11.0)
        cruise = (min(lawful, agent.cruise_ms) if agent.cruise_ms else lawful) * agent.excess
        return cruise * congestion_factor(volume, CAPACITY.get(road_class, 8))

    def step(self, dt: float) -> list[Agent]:
        """Move every agent ``dt`` seconds along its route; returns those that arrived."""
        load = self.volumes()
        arrived = []
        for agent in self.agents.values():
            if agent.done:
                continue
            budget = dt
            while budget > 0 and agent.leg < len(agent.route) - 1:
                a, b = agent.route[agent.leg], agent.route[agent.leg + 1]
                edge = self.graph.edge(a, b, agent.mode)
                v = max(0.3, self.speed(agent, edge.road_class, load[(a, b)]))
                left = edge.length_m - agent.along_m
                if left <= v * budget:
                    budget -= left / v
                    agent.travelled_m += left
                    agent.leg += 1
                    agent.along_m = 0.0
                else:
                    agent.along_m += v * budget
                    agent.travelled_m += v * budget
                    budget = 0
            if agent.leg >= len(agent.route) - 1:
                agent.done = True
                arrived.append(agent)
        return arrived

    def near(self, x: float, y: float, radius: float) -> list[Agent]:
        return [a for a in self.agents.values() if math.dist(a.position(self.graph), (x, y)) <= radius]
