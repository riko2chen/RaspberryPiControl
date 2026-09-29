/** A full-page switch tears down the previous device's queues and live connection. */
export function localDeviceUrl(href: string, demo: boolean): string {
  const url = new URL(href);
  if (demo) url.searchParams.set('device', 'demo');
  else url.searchParams.delete('device');
  url.hash = 'devices';
  return url.href;
}

function localController(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const octets = host.split('.').map(Number);
    const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && octets.every(n => n >= 0 && n <= 255);
    const privateIp = ipv4 && (octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127));
    const localName = /^[a-z0-9-]+$/.test(host) || host.endsWith('.local') || host.endsWith('.ts.net');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || (!privateIp && !localName)) return null;
    url.hash = 'devices';
    return url.href;
  } catch { return null; }
}

/** Return only an explicit local console link, never an arbitrary redirect. */
export function controllerUrl(href: string): string | null {
  const current = new URL(href);
  const value = current.searchParams.get('controller');
  const result = value ? localController(value) : null;
  return result && new URL(result).origin !== current.origin ? result : null;
}

export function remoteDeviceUrl(target: string, source: string): string {
  const next = new URL('/', target);
  const origin = new URL(source).origin + '/';
  const controller = controllerUrl(source) || localController(origin);
  if (controller && new URL(controller).origin !== next.origin) {
    next.searchParams.set('controller', controller);
  }
  return next.href;
}
