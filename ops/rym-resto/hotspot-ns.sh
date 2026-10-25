#!/bin/bash
# Aísla SOLO el tráfico de RYM por el hotspot del móvil, sin tocar la ethernet.
#
# Por qué: RYM cortó la IP de fibra (Vivo) el 2026-10-19 tras ~12,7k fichas. El hotspot
# (Claro móvil) da otra IP y otro ASN. Con un netns propio, el Firefox/capturador salen por
# el wifi mientras los túneles de alumnar, Docker y Postgres siguen por la ethernet intactos.
#
#   sudo bash ops/rym-resto/hotspot-ns.sh up       # crea netns + NAT por el wifi
#   sudo bash ops/rym-resto/hotspot-ns.sh status    # IP pública de cada salida
#   sudo bash ops/rym-resto/hotspot-ns.sh down      # desmonta
#
# Uso del netns:  sudo ip netns exec rym <comando>
#   sudo ip netns exec rym curl -s https://api.ipify.org
set -eu
NS="${NS:-rym}"
IFACE="${IFACE:-wlx90de809e224d}"
HOST_IP=10.200.0.1
NS_IP=10.200.0.2
SUBNET=10.200.0.0/24

case "${1:-}" in
up)
  ip netns del "$NS" 2>/dev/null || true
  ip link del veth-rym 2>/dev/null || true
  ip netns add "$NS"
  ip link add veth-rym type veth peer name veth-ns-rym
  ip link set veth-ns-rym netns "$NS"
  ip addr add "$HOST_IP/24" dev veth-rym
  ip link set veth-rym up
  ip netns exec "$NS" ip addr add "$NS_IP/24" dev veth-ns-rym
  ip netns exec "$NS" ip link set veth-ns-rym up
  ip netns exec "$NS" ip link set lo up
  ip netns exec "$NS" ip route add default via "$HOST_IP"
  mkdir -p "/etc/netns/$NS"
  printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "/etc/netns/$NS/resolv.conf"
  sysctl -qw net.ipv4.ip_forward=1
  sysctl -qw net.ipv4.conf.veth-rym.forwarding=1
  sysctl -qw net.ipv4.conf.veth-rym.rp_filter=2
  # La tabla principal manda todo por la ethernet: sin esta regla el netns saldría por la fibra
  # (y el NAT «-o wifi» nunca casaría). Tabla 100 = SOLO la subred del netns, por el wifi.
  GW=$(ip -4 route show default dev "$IFACE" | awk '{print $3; exit}')
  RED=$(ip -4 route show dev "$IFACE" scope link | awk '{print $1; exit}')
  ip route replace "$RED" dev "$IFACE" table 100 2>/dev/null || true
  ip route replace default via "$GW" dev "$IFACE" table 100
  ip rule add from "$SUBNET" lookup 100 priority 100 2>/dev/null || true
  # NAT hacia el wifi SOLO para la subred del netns (la ethernet no se toca)
  iptables -t nat -C POSTROUTING -s "$SUBNET" -o "$IFACE" -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -s "$SUBNET" -o "$IFACE" -j MASQUERADE
  iptables -C FORWARD -i veth-rym -o "$IFACE" -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD -i veth-rym -o "$IFACE" -j ACCEPT
  iptables -C FORWARD -i "$IFACE" -o veth-rym -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD -i "$IFACE" -o veth-rym -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  echo "netns $NS listo por $IFACE ($NS_IP → NAT)"
  ip netns exec "$NS" curl -s -m 10 https://api.ipify.org && echo " ← IP pública del netns"
  ;;
down)
  ip rule del from 10.200.0.0/24 lookup 100 priority 100 2>/dev/null || true
  ip route flush table 100 2>/dev/null || true
  iptables -t nat -D POSTROUTING -s "$SUBNET" -o "$IFACE" -j MASQUERADE 2>/dev/null || true
  iptables -D FORWARD -i veth-rym -o "$IFACE" -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "$IFACE" -o veth-rym -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  ip netns del "$NS" 2>/dev/null || true
  ip link del veth-rym 2>/dev/null || true
  rm -rf "/etc/netns/$NS"
  echo "netns $NS desmontado"
  ;;
status)
  printf 'ethernet  '; curl -s -m 10 https://api.ipify.org || echo "(sin salida)"; echo
  printf 'hotspot   '; ip netns exec "$NS" curl -s -m 10 https://api.ipify.org || echo "(sin salida)"; echo
  printf 'ASN wifi  '; curl -s -m 10 --interface "$IFACE" https://ipinfo.io/org 2>/dev/null || echo "?"
  ;;
*)
  echo "uso: $0 up|down|status" >&2
  exit 2
  ;;
esac
