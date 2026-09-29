from src.utils.secret_compare import bearer_matches


def test_accepts_matching_bearer():
    assert bearer_matches("Bearer super-secret", "super-secret") is True


def test_rejects_missing_or_wrong_length_without_raising():
    assert bearer_matches(None, "super-secret") is False
    assert bearer_matches("Bearer super-secret", None) is False
    assert bearer_matches("Bearer x", "super-secret") is False
    assert bearer_matches("super-secret", "super-secret") is False
    assert bearer_matches("Bearer other", "super-secret") is False
