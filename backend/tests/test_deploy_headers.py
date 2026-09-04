"""The nginx headers are deploy configuration with no other test around them,
and getting them wrong breaks the app silently — the server keeps serving, the
browser quietly refuses to run something. Each check below pins a rule that was
found the hard way."""

from pathlib import Path

import pytest

CONF = Path(__file__).resolve().parents[2] / "infra" / "nginx" / "security-headers.conf"


@pytest.fixture(scope="module")
def csp() -> str:
    text = CONF.read_text()
    line = next(l for l in text.splitlines() if "Content-Security-Policy" in l)
    return line.split('"')[1]


def test_csp_allows_webassembly(csp: str):
    """Mesh import decimates through meshoptimizer, which is WebAssembly.
    Compiling WASM counts as eval, so a policy without this grant means every
    import fails with a CompileError — and nothing else looks wrong."""
    assert "wasm-unsafe-eval" in csp, (
        "CSP would block WebAssembly, breaking mesh import. Add "
        "'wasm-unsafe-eval' to script-src."
    )


def test_csp_does_not_allow_plain_eval(csp: str):
    """'wasm-unsafe-eval' is the narrow grant. 'unsafe-eval' would also permit
    eval() on strings, which is the thing the policy exists to stop."""
    assert "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")


def test_hsts_is_sent():
    text = CONF.read_text()
    assert "Strict-Transport-Security" in text
    # Not includeSubDomains: this is a subdomain and must not speak for siblings.
    hsts = next(l for l in text.splitlines() if "Strict-Transport-Security" in l)
    assert "includeSubDomains" not in hsts


def test_csp_keeps_the_protections_that_matter(csp: str):
    for directive in ("default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"):
        assert directive in csp, f"missing {directive}"


def test_every_header_setting_location_reincludes_the_headers():
    """nginx's add_header does not merge across levels: a location that sets
    any header of its own silently discards every inherited one. Any location
    with an add_header must re-include this file."""
    conf = (CONF.parent / "nginx.conf").read_text()
    blocks = conf.split("location ")[1:]
    for block in blocks:
        body = block[: block.index("}")] if "}" in block else block
        if "add_header" in body:
            assert "security-headers.conf" in body, (
                f"location '{body.splitlines()[0].strip()}' sets a header but does not "
                "re-include security-headers.conf, so it drops all of them"
            )


def test_boolean_engine_needs_no_eval(csp: str):
    """The boolean engine is WebAssembly with a JavaScript loader. The stock
    loader builds functions from strings, which the CSP blocks — and the app
    then falls back to the old engine so quietly that the only symptom is a
    slicer complaining about the export. The vendored loader is built with
    dynamic execution disabled; make sure it stays that way, and that the
    policy still refuses eval so the guard is meaningful."""
    loader = CONF.parents[2] / "pwa" / "vendor" / "manifold" / "manifold.js"
    assert loader.exists(), "vendored Manifold loader missing (pwa/vendor/manifold)"
    text = loader.read_text()
    for needle in ("new Function(", "Function.bind.apply", "eval("):
        assert needle not in text, (
            f"Manifold loader uses {needle!r}, which the CSP blocks; rebuild it "
            "with -sDYNAMIC_EXECUTION=0 (see pwa/vendor/manifold/README.md)"
        )
    assert "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
