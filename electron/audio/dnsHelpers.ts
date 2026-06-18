// electron/audio/dnsHelpers.ts
// IPv4-only DNS lookup with caching for WebSocket STT connections.
// Prevents IPv6 failures on dual-stack networks.

import * as dns from 'dns';

interface DnsCacheEntry {
  addr: string;
  expires: number;
}

const _dnsCache = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL_MS = 60_000;

/**
 * DNS lookup that forces IPv4 resolution with a 60-second cache.
 * Falls back to dns.resolve4() if lookup fails, and serves stale IPs
 * if both fail (to survive transient DNS outages).
 */
export const ipv4OnlyLookup = (
  hostname: string,
  options: any,
  callback?: any,
): void => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const cacheKey = hostname;
  const cached = _dnsCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return callback(null, cached.addr, 4);
  }

  const store = (addr: string) => {
    _dnsCache.set(cacheKey, { addr, expires: Date.now() + DNS_CACHE_TTL_MS });
    callback(null, addr, 4);
  };

  dns.lookup(hostname, { ...options, family: 4 }, (err, addr) => {
    if (!err) return store(addr);
    dns.resolve4(hostname, (err4, addrs) => {
      if (!err4 && addrs?.length > 0) return store(addrs[0]);
      if (cached) {
        console.warn(`[dnsHelpers] resolver failed for ${hostname}, serving stale IP ${cached.addr}`);
        return callback(null, cached.addr, 4);
      }
      const e: any = new Error('No A records for ' + hostname);
      e.code = 'ENOTFOUND';
      callback(e);
    });
  });
};

/** Pre-configured WebSocket options for streaming STT connections. */
export function streamingStttWsOptions(extra?: Record<string, any>): Record<string, any> {
  return {
    lookup: ipv4OnlyLookup,
    family: 4,
    handshakeTimeout: 15_000,
    ...(extra || {}),
  };
}
