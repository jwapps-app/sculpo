import hashlib
import secrets

import bcrypt

# Verified against when the user doesn't exist, so login timing doesn't
# reveal which emails have accounts.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    target = password_hash.encode() if password_hash else _DUMMY_HASH
    ok = bcrypt.checkpw(password.encode(), target)
    return ok and password_hash is not None


def new_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hash). Only the hash is ever stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
