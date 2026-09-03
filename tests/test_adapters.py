"""Tests for credentials and provider selection."""

from __future__ import annotations

import pytest

from smc.adapters.base import AdapterUnavailable
from smc.adapters.credentials import CREDENTIALS, Capability, check, providers_for
from smc.adapters.providers import (
    ArCoreGeospatial,
    MapillaryImagery,
    StreetViewImagery,
    build_anchor_imagery,
    build_visual_positioning,
)


class TestCredentialRegistry:
    def test_every_credential_is_documented(self) -> None:
        for c in CREDENTIALS:
            assert c.env_var and c.service and c.purpose and c.where_to_get and c.free_tier

    def test_env_vars_are_unique(self) -> None:
        names = [c.env_var for c in CREDENTIALS]
        assert len(names) == len(set(names))

    def test_google_maps_is_marked_not_commercial_safe(self) -> None:
        """The single most consequential flag in the file."""
        maps = next(c for c in CREDENTIALS if c.env_var == "GOOGLE_MAPS_API_KEY")
        arcore = next(c for c in CREDENTIALS if c.env_var == "GOOGLE_ARCORE_API_KEY")
        assert not maps.commercial_safe
        assert not arcore.commercial_safe

    def test_every_unsafe_capability_has_a_safe_alternative(self) -> None:
        """An escape hatch is only an escape hatch if something else can take its place."""
        for capability in Capability:
            providers = providers_for(capability)
            if any(not p.commercial_safe for p in providers):
                assert any(p.commercial_safe for p in providers), capability

    def test_missing_required_credentials_fail_the_check(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for c in CREDENTIALS:
            monkeypatch.delenv(c.env_var, raising=False)
        report = check()
        assert not report.ok
        # Anchor imagery is no longer on this list: Panoramax needs no credential.
        assert {c.env_var for c in report.missing_required} == {
            "HUGGINGFACE_TOKEN",
            "SMC_DATABASE_URL",
            "SMC_OBJECT_STORE_URL",
        }

    def test_report_warns_about_configured_unsafe_providers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "x")
        assert "NOT COMMERCIAL-SAFE" in check().render()


class TestProviderSelection:
    def test_unsafe_provider_requires_an_explicit_opt_in(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "x")
        with pytest.raises(AdapterUnavailable, match="not commercial-safe"):
            build_anchor_imagery("street_view")
        assert isinstance(
            build_anchor_imagery("street_view", allow_internal_only=True), StreetViewImagery
        )

    def test_default_provider_needs_no_credential(self) -> None:
        provider = build_anchor_imagery("panoramax")
        assert provider.requires_credential is False  # type: ignore[attr-defined]

    def test_mapillary_is_selectable_since_the_non_commercial_pivot(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The guard was about competitive exposure, which a non-commercial project does not have.

        What it was never about is the licence: Mapillary imagery is CC BY-SA 4.0, the same
        share-alike terms as Panoramax, so selecting it is a coverage decision.
        """
        monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "x")
        assert isinstance(build_anchor_imagery("mapillary"), MapillaryImagery)

    def test_mapillary_can_still_be_refused_deliberately(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "x")
        with pytest.raises(AdapterUnavailable, match="allow_platform_dependency=False"):
            MapillaryImagery(allow_platform_dependency=False)

    def test_missing_credential_is_reported_clearly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("MAPILLARY_ACCESS_TOKEN", raising=False)
        with pytest.raises(AdapterUnavailable, match="MAPILLARY_ACCESS_TOKEN"):
            MapillaryImagery(allow_platform_dependency=True)

    def test_unknown_provider_rejected(self) -> None:
        with pytest.raises(AdapterUnavailable, match="unknown"):
            build_anchor_imagery("bing")

    def test_arcore_is_gated_the_same_way(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GOOGLE_ARCORE_API_KEY", "x")
        with pytest.raises(AdapterUnavailable, match="not commercial-safe"):
            build_visual_positioning("arcore_geospatial")
        assert isinstance(
            build_visual_positioning("arcore_geospatial", allow_internal_only=True),
            ArCoreGeospatial,
        )

    def test_default_choice_is_the_safe_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from smc.adapters.providers import ProviderChoice

        choice = ProviderChoice()
        assert choice.anchor_imagery == "panoramax"
        assert build_anchor_imagery(choice.anchor_imagery).commercial_safe  # type: ignore[attr-defined]
        assert build_visual_positioning(choice.visual_positioning).commercial_safe  # type: ignore[attr-defined]


class TestMapillaryQuery:
    def test_bbox_is_centred_on_the_request(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "tok")
        params = MapillaryImagery(allow_platform_dependency=True).request_params(
            38.9072, -77.0369, radius_m=50.0, limit=25
        )
        west, south, east, north = (float(v) for v in params["bbox"].split(","))
        assert west < -77.0369 < east
        assert south < 38.9072 < north
        assert params["limit"] == "25"
        assert params["access_token"] == "tok"
