"""City government: residents vote, a council passes laws, an NPC administration fills in.

Each incorporated city has a mayor and a five-seat council elected by its resident players
(resident ``VOTER_RESIDENCY_DAYS`` before voting, one city each). An election with fewer eligible
voters than ``MIN_ELECTORATE`` changes nothing: the neutral NPC administration stays, keeps the
laws in force and the services running, and proposes nothing. A seated council passes a
proposal by a majority of its seats; what passes is enacted into the ``LawBook`` from its
effective time, and is only ever rules the law engine supports.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from smc.city.law import LawBook, LawError, Rule
from smc.city.params import COUNCIL_SEATS, MIN_ELECTORATE, TERM_DAYS, VOTER_RESIDENCY_DAYS

DAY_S = 86_400.0
NPC_ADMINISTRATION = "npc:administration"


class GovernmentError(Exception):
    pass


@dataclass
class Proposal:
    id: str
    law_id: str
    title: str
    text: str
    rules: list[Rule]
    proposer: str
    effective_at: float
    votes: dict[str, bool] = field(default_factory=dict)
    outcome: str | None = None  # passed | failed


@dataclass
class Government:
    jurisdiction: str
    laws: LawBook
    mayor: str = NPC_ADMINISTRATION
    council: list[str] = field(default_factory=list)
    term_ends: float = 0.0
    #: player -> (city, since): where each player is resident for voting
    residents: dict[str, tuple[str, float]] = field(default_factory=dict)
    proposals: dict[str, Proposal] = field(default_factory=dict)

    @property
    def npc_administration(self) -> bool:
        return not self.council

    # ---- residency and elections ---------------------------------------------------------
    def register_resident(self, player: str, *, at: float) -> None:
        city, _ = self.residents.get(player, (None, None))
        if city != self.jurisdiction:
            self.residents[player] = (self.jurisdiction, float(at))

    def eligible(self, at: float) -> list[str]:
        return sorted(p for p, (city, since) in self.residents.items()
                      if city == self.jurisdiction and at - since >= VOTER_RESIDENCY_DAYS * DAY_S)

    def elect(self, ballots: dict[str, list[str]], *, at: float) -> dict:
        """One ballot per eligible voter: [mayor choice, council choices...]. Returns the result.

        Below the minimum electorate nothing changes and the NPC administration continues."""
        voters = set(self.eligible(at))
        counted = {v: b for v, b in ballots.items() if v in voters and b}
        if len(voters) < MIN_ELECTORATE or not counted:
            return {"held": False, "reason": f"{len(voters)} eligible voters; {MIN_ELECTORATE} needed",
                    "administration": NPC_ADMINISTRATION}
        mayor_votes = Counter(b[0] for b in counted.values())
        council_votes = Counter(c for b in counted.values() for c in dict.fromkeys(b[1:]))
        mayor = sorted(mayor_votes.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        council = [c for c, _ in sorted(council_votes.items(), key=lambda kv: (-kv[1], kv[0]))
                   if c != mayor][:COUNCIL_SEATS]
        self.mayor, self.council, self.term_ends = mayor, council, at + TERM_DAYS * DAY_S
        return {"held": True, "turnout": len(counted), "electorate": len(voters), "mayor": mayor,
                "council": council, "term_ends": self.term_ends}

    def expire_term(self, *, at: float) -> bool:
        if self.council and at >= self.term_ends:
            self.mayor, self.council = NPC_ADMINISTRATION, []
            return True
        return False

    # ---- legislating ---------------------------------------------------------------------
    def propose(self, proposal_id: str, law_id: str, title: str, text: str, rules: list[Rule], *,
                proposer: str, effective_at: float) -> Proposal:
        if self.npc_administration:
            raise GovernmentError("no council is seated: the NPC administration does not legislate")
        if proposer != self.mayor and proposer not in self.council:
            raise GovernmentError(f"{proposer} holds no office in {self.jurisdiction}")
        try:
            checked = [rule.validate() for rule in rules]
        except LawError as error:
            raise GovernmentError(f"not an enforceable law: {error}") from error
        proposal = Proposal(proposal_id, law_id, title, text, checked, proposer, float(effective_at))
        self.proposals[proposal_id] = proposal
        return proposal

    def vote(self, proposal_id: str, member: str, yes: bool) -> None:
        proposal = self.proposals[proposal_id]
        if proposal.outcome:
            raise GovernmentError(f"{proposal_id} was already {proposal.outcome}")
        if member not in self.council:
            raise GovernmentError(f"{member} has no council seat")
        proposal.votes[member] = bool(yes)

    def tally(self, proposal_id: str, *, at: float) -> str:
        """Decide once a majority of seats has voted the same way; enact if it passed."""
        proposal = self.proposals[proposal_id]
        if proposal.outcome:
            return proposal.outcome
        need = COUNCIL_SEATS // 2 + 1
        yes = sum(proposal.votes.values())
        no = len(proposal.votes) - yes
        if yes >= need:
            self.laws.enact(proposal.law_id, self.jurisdiction, proposal.title, proposal.text, proposal.rules,
                            effective_at=max(proposal.effective_at, at), enacted_by=f"council:{proposal.id}")
            proposal.outcome = "passed"
        elif no > len(self.council) - need:
            proposal.outcome = "failed"
        return proposal.outcome or "open"
