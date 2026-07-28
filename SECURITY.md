# Security

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Open the repository's **Security** tab and choose *Report a vulnerability*,
which sends it privately to the maintainer.

Include what you did, what happened, and what you expected. A proof of concept
helps. You will get an acknowledgement; this is a personal project, so please
expect days rather than hours.

## Scope

This is self-hosted software. The interesting surface is the optional sync
server in `backend/` and the nginx config in `infra/`, both of which handle
accounts and untrusted input.

Reports that are in scope:

- Authentication or session handling flaws
- Access to another user's projects
- Injection, SSRF, or remote code execution
- Denial of service reachable without an account
- Secrets exposed by the container or CI configuration

Out of scope:

- Anything requiring a malicious operator — an admin can already do anything
  to their own instance
- Findings against a deployment's own misconfiguration, e.g. running without
  `ADMIN_SIGNUP_SECRET` on a public address (documented in the README as a
  configuration requirement)
- Missing hardening headers with no demonstrated impact
- Automated scanner output without a working proof of concept

## What the project already does

- Passwords are bcrypt-hashed; input is SHA-256 pre-hashed so a long
  passphrase cannot hit bcrypt's 72-byte ceiling
- Session tokens are opaque and stored hashed; changing a password revokes
  every other session
- Every project query is scoped to its owner — another user's id returns 404,
  not 403
- Registration is closed by default and gives identical refusals, so it cannot
  be used to enumerate usernames
- Request bodies over the cap are rejected on `Content-Length`, before parsing
- Login is throttled per username by the app and per source address by nginx

Fixes for previously-reported issues are pinned by tests in
`backend/tests/test_security_regressions.py`.
