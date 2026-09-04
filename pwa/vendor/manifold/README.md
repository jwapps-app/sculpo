# Manifold, built without dynamic execution

This is [Manifold](https://github.com/elalish/manifold)'s WebAssembly build,
the app's boolean engine, compiled from the tag in `VERSION` with
`-sDYNAMIC_EXECUTION=0`.

The build published to npm as `manifold-3d` is identical except that its
JavaScript loader creates functions from strings at startup. The site's
Content Security Policy forbids that, so on a real deployment the engine
never starts and every group quietly falls back to the old engine. The
`manifold-3d` package is still a dependency, for its type definitions only;
the code that runs is this copy.

To upgrade, change `VERSION` and run `scripts/build-manifold.sh`. It needs
Docker and nothing else. `backend/tests/test_deploy_headers.py` checks that
the loader here contains no `new Function` or `eval`.
