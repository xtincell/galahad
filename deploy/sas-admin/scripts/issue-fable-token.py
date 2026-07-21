#!/usr/bin/env python3
"""Émet un JWT pour Fable. Le secret vient de l'env SAS_JWT_SECRET (le même
que la passerelle). TTL court par défaut ; ré-émettre à l'expiration.

  SAS_JWT_SECRET=$(grep ^SAS_JWT_SECRET .env | cut -d= -f2) \
      python3 scripts/issue-fable-token.py --sub fable --hours 12
"""
import os, sys, time, uuid, argparse, jwt

ap = argparse.ArgumentParser()
ap.add_argument("--sub", default="fable", help="identité (sujet)")
ap.add_argument("--hours", type=float, default=12.0, help="durée de vie")
ap.add_argument("--aud", default=os.environ.get("SAS_AUDIENCE", "danhermes-admin"))
a = ap.parse_args()

secret = os.environ.get("SAS_JWT_SECRET")
if not secret:
    sys.exit("SAS_JWT_SECRET manquant (exporte-le depuis .env)")

now = int(time.time())
jti = uuid.uuid4().hex
tok = jwt.encode({"sub": a.sub, "aud": a.aud, "iat": now,
                  "exp": now + int(a.hours * 3600), "jti": jti},
                 secret, algorithm="HS256")
print(f"# jti={jti}  sub={a.sub}  exp=+{a.hours}h", file=sys.stderr)
print(tok)
