import hashlib
import secrets


def new_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hash). Only the hash is ever stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
