#!/usr/bin/env python3
"""Révoque un JWT par son jti (coupe-circuit immédiat).

  python3 scripts/revoke-token.py <jti>                 # via volume Docker
  SAS_REVOKED_FILE=/chemin/revoked.json python3 ... <jti>
"""
import os, sys, json

if len(sys.argv) < 2:
    sys.exit("usage: revoke-token.py <jti>")
jti = sys.argv[1]
path = os.environ.get("SAS_REVOKED_FILE", "/data/revoked.json")
try:
    with open(path) as f:
        data = set(json.load(f))
except Exception:
    data = set()
data.add(jti)
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(sorted(data), f)
print(f"révoqué: {jti}  ({len(data)} au total dans {path})")
