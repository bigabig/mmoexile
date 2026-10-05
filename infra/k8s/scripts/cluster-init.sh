#!/usr/bin/env bash
# pnpm cluster:init — the cluster's secrets, generated once into
# infra/k8s/.secrets/ (git-ignored, readable only by you):
#
#   ca.crt / ca.key                    a local certificate authority (CA)
#   <postgres|pgbouncer|redis>.crt/.key  server certificates signed by it, for
#                                      the names clients use (SANs)
#   postgres-migrate-password          owns the schema, runs migrations
#   postgres-app-password              the services: read and write data only
#   postgres-monitor-password          the metrics exporters (Postgres, PgBouncer)
#   redis-password                     Redis' ACL user "mmoexile"
#   redis-monitor-password             Redis' ACL user "monitor" (exporter)
#   ticket-private-key / -public-key   Ed25519, signs/verifies transfer tickets
#   session-secret                     signs session tokens (account-api)
#
# Idempotent: creates what is missing and keeps the rest, so cluster:up can
# run it every time.
#
#   pnpm cluster:init -- --rotate     new passwords and keys (CA and
#                                     certificates stay); then
#                                     pnpm cluster-db:up && pnpm cluster:up
#   pnpm cluster:init -- --rotate-ca  also a new CA and new certificates
source "$(dirname "$0")/lib.sh"
[[ "${1:-}" == -- ]] && shift  # pnpm passes "--" on

rotate=false
rotate_ca=false
for arg in "$@"; do
  case "$arg" in
    --rotate) rotate=true ;;
    --rotate-ca) rotate=true; rotate_ca=true ;;
    *) fail "Usage: pnpm cluster:init [-- --rotate | --rotate-ca]" ;;
  esac
done

command -v openssl >/dev/null || fail "openssl not found (see docs/DEVELOPMENT_SETUP.md)"
umask 077
mkdir -p "$SECRETS"
chmod 700 "$SECRETS"

# The names each server's certificate is valid for: what clients connect to
# inside the cluster (the Services in overlays/kind), the container's name
# on the Docker network, and localhost (cluster-db:psql, the host)
sans() {
  local service=$1
  echo "DNS:$service,DNS:$service.$NAMESPACE,DNS:$service.$NAMESPACE.svc,DNS:$service.$NAMESPACE.svc.cluster.local,DNS:$(db_container "$service"),DNS:localhost,IP:127.0.0.1"
}

# new <file>: true if the file is missing, or should be replaced now
new() { [[ ! -s "$SECRETS/$1" ]] || $2; }

created=()

step "Certificate authority"
if new ca.key "$rotate_ca"; then
  openssl req -x509 -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout "$SECRETS/ca.key" -out "$SECRETS/ca.crt" -days 3650 \
    -subj "/O=mmoexile/CN=mmoexile local CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  created+=(ca.crt)
  rotate_certs=true
else
  rotate_certs=false
fi
openssl x509 -in "$SECRETS/ca.crt" -noout -subject -enddate | paste -sd' '

step "Server certificates"
for service in postgres pgbouncer redis; do
  if new "$service.key" "$rotate_certs"; then
    openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
      -keyout "$SECRETS/$service.key" -subj "/O=mmoexile/CN=$service" 2>/dev/null |
      openssl x509 -req -CA "$SECRETS/ca.crt" -CAkey "$SECRETS/ca.key" -CAcreateserial \
        -out "$SECRETS/$service.crt" -days 825 \
        -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\n' "$(sans "$service")") 2>/dev/null
    created+=("$service.crt")
  fi
  echo "$service: $(openssl x509 -in "$SECRETS/$service.crt" -noout -ext subjectAltName | tail -1 | sed 's/^ *//')"
done
rm -f "$SECRETS/ca.srl"

step "Passwords and keys"
# Letters and digits only: they go into URLs unescaped
password() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32; }
for name in postgres-migrate-password postgres-app-password postgres-monitor-password redis-password redis-monitor-password; do
  if new "$name" "$rotate"; then
    password >"$SECRETS/$name"
    created+=("$name")
  fi
done
if new session-secret "$rotate"; then
  openssl rand -hex 32 | tr -d "\n" >"$SECRETS/session-secret"
  created+=(session-secret)
fi
if new ticket-private-key "$rotate"; then
  # Base64 DER (PKCS#8 / SPKI), the format @mmoexile/auth reads
  openssl genpkey -algorithm ed25519 -out "$SECRETS/ticket.pem"
  openssl pkey -in "$SECRETS/ticket.pem" -outform DER | base64 -w0 >"$SECRETS/ticket-private-key"
  openssl pkey -in "$SECRETS/ticket.pem" -pubout -outform DER | base64 -w0 >"$SECRETS/ticket-public-key"
  rm -f "$SECRETS/ticket.pem"
  created+=(ticket-private-key ticket-public-key)
fi

chmod 600 "$SECRETS"/*
if (( ${#created[@]} )); then
  echo "created: ${created[*]}"
else
  echo "all present, nothing changed"
fi
echo "in $SECRETS"
