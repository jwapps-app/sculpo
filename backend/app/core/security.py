import base64
import hashlib
import secrets

import bcrypt

# Verified against when the user doesn't exist, so login timing doesn't
# reveal which usernames have accounts. Random input so it matches nothing.
_DUMMY_HASH = bcrypt.hashpw(base64.b64encode(secrets.token_bytes(32)), bcrypt.gensalt())


# bcrypt refuses anything over 72 bytes outright (it used to truncate), so a
# long passphrase would otherwise raise straight out of an unauthenticated
# endpoint. Pre-hashing keeps every byte of the password meaningful and makes
# the input to bcrypt a fixed, safe length.
def _prepare(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode()).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    # Always run a real bcrypt comparison, even with no stored hash, so a
    # missing user takes the same time as a wrong password.
    target = password_hash.encode() if password_hash else _DUMMY_HASH
    ok = bcrypt.checkpw(_prepare(password), target)
    if not ok and password_hash and _is_legacy_length(password):
        # Accounts created before pre-hashing stored bcrypt(password) directly.
        # Keep them working; login re-hashes them into the new format.
        ok = bcrypt.checkpw(password.encode(), target)
    # An empty/absent hash must never authenticate: without this an empty
    # column value would fall through to the dummy hash and accept its
    # placeholder password.
    return ok and bool(password_hash)


def _is_legacy_length(password: str) -> bool:
    return len(password.encode()) <= 72


def needs_rehash(password: str, password_hash: str) -> bool:
    """True when the stored hash is the pre-upgrade format, so the caller can
    transparently migrate it after a successful login."""
    return not bcrypt.checkpw(_prepare(password), password_hash.encode())


def new_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hash). Only the hash is ever stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
