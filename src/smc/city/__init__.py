"""Kerbside V2's city core: the authoritative, persistent economy of a city district.

``world.World`` is the server's world; everything else is a part of it:

- ``currency``/``ledger``: the placeholder currency (Credits) and the double-entry ledger every
  payment, wage, tax, fine and sale goes through.
- ``property``: who owns and who has each asset, inventories of goods, and every transfer.
- ``law``/``government``: laws as executable rules by jurisdiction; offences, fines; councils,
  elections and the NPC administration.
- ``streets``/``agents``/``vehicles``: the real street network, movement at lawful speeds with
  congestion, cars and NPC traffic.
- ``npc``: the district's simulated population, its schedules and what it buys.
- ``district``: a world built from a region's map data.

See README.md beside this file for what exists and what comes next.
"""
