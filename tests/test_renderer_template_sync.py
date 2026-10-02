"""A generated page must not become a newer, unrepeatable renderer version."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_published_sf_renderer_matches_builder_template() -> None:
    builder = (ROOT / "scripts/build_sf_corridor_3d.py").read_text(encoding="utf-8")
    marker = 'HTML = r"""'
    start = builder.index(marker) + len(marker)
    end = builder.index('"""', start)
    template = builder[start:end]
    published = (ROOT / "docs/sf-corridor-3d.html").read_text(encoding="utf-8")
    assert template == published, (
        "docs/sf-corridor-3d.html has diverged from the canonical builder template; "
        "synchronize the complete page before shipping or rebuilding regions"
    )
