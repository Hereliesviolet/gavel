from src.storage.postgres import (
    ZVG_BUNDESLAND_SLUG_UNIQUE,
    is_slug_unique_violation,
    unique_slug_candidate,
)


def test_unique_slug_keeps_free_base():
    assert unique_slug_candidate("haus-berlin", lambda _: False) == "haus-berlin"


def test_unique_slug_appends_counter():
    taken = {"haus-berlin", "haus-berlin-2"}
    assert unique_slug_candidate("haus-berlin", taken.__contains__) == "haus-berlin-3"


def test_unique_slug_falls_back_for_empty_base():
    assert unique_slug_candidate("", lambda _: False) == "objekt"


def test_slug_unique_violation_detects_constraint():
    class FakeUnique(Exception):
        def __init__(self) -> None:
            super().__init__(
                f'duplicate key value violates unique constraint "{ZVG_BUNDESLAND_SLUG_UNIQUE}"'
            )
            self.constraint_name = ZVG_BUNDESLAND_SLUG_UNIQUE

    assert is_slug_unique_violation(FakeUnique()) is True
    assert is_slug_unique_violation(ValueError("other")) is False
