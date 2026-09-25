#!/bin/sh
# Renders the list of proxies whose CF-Connecting-IP header nginx believes,
# from TRUSTED_PROXY_CIDRS (comma-separated CIDRs). Empty means none: every
# client is taken to be at its socket address, and a forged header changes
# nothing. Runs from the image's entrypoint before nginx starts.
set -e
# Outside conf.d: everything named *.conf there is also read as top-level
# configuration, where an address list is not valid.
out=/etc/nginx/trusted-proxies.geo
: > "$out"
IFS=','
for cidr in ${TRUSTED_PROXY_CIDRS:-}; do
  cidr=$(echo "$cidr" | tr -d '[:space:]')
  [ -n "$cidr" ] && echo "$cidr 1;" >> "$out"
done
echo "trusted proxies: $(tr '\n' ' ' < "$out")"
