import json

from src.storage.minio import public_read_bucket_policy


def test_public_policy_denies_custom_listing_prefix():
    policy = public_read_bucket_policy("zvg-images")
    assert "zvg-images/*" in policy
    assert "zvg-images/real-estate/*" in policy
    assert "zvg-images/real-estate/*/*" in policy
    assert '"Effect": "Deny"' in policy


def test_public_policy_denies_gutachten_and_expose_paths():
    parsed = json.loads(public_read_bucket_policy("zvg-images"))
    deny = next(stmt for stmt in parsed["Statement"] if stmt["Effect"] == "Deny")
    resources = deny["Resource"]
    assert "arn:aws:s3:::zvg-images/real-estate/*" in resources
    assert "arn:aws:s3:::zvg-images/real-estate/*/*" in resources
    assert "arn:aws:s3:::zvg-images/*/gutachten.pdf" in resources
    assert "arn:aws:s3:::zvg-images/*/expose.pdf" in resources
    assert "arn:aws:s3:::zvg-images/*/*/gutachten.pdf" in resources
    assert "arn:aws:s3:::zvg-images/*/*/expose.pdf" in resources
