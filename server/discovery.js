'use strict';

const os = require('os');
const net = require('net');
const dns = require('dns');

const SCAN_TTL_MS = 15000;

function createDiscovery() {
  let scanCache = null;

  function localSubnets() {
    const out = [];
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs || []) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        out.push({ iface: name, address: addr.address, netmask: addr.netmask, cidr: `${addr.address}/${maskToPrefix(addr.netmask)}` });
      }
    }
    return out;
  }

  function maskToPrefix(mask) {
    return String(mask)
      .split('.')
      .map((part) => Number(part).toString(2).padStart(8, '0'))
      .join('')
      .replace(/0+$/, '').length;
  }

  function ipToInt(ip) {
    return ip.split('.').reduce((acc, part) => ((acc << 8) | (Number(part) & 255)) >>> 0, 0);
  }

  function intToIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  function scanTargets() {
    const targets = [];
    const seen = new Set();
    const subnets = localSubnets();
    for (const subnet of subnets) {
      const ip = ipToInt(subnet.address);
      const mask = ipToInt(subnet.netmask);
      let start = (ip & mask) + 1;
      let end = ((ip & mask) | (~mask >>> 0)) - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      if (end - start > 1024) {
        const base = ip & 0xffffff00;
        start = base + 1;
        end = base + 254;
      }
      for (let n = start; n <= end; n += 1) {
        const host = intToIp(n >>> 0);
        if (!seen.has(host)) {
          seen.add(host);
          targets.push(host);
        }
      }
      if (!seen.has(subnet.address)) {
        seen.add(subnet.address);
        targets.push(subnet.address);
      }
    }
    return { targets, subnets };
  }

  function probeSsh(host, timeout = 650) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let banner = '';
      let settled = false;

      const done = (open) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ host, open, banner: banner.trim() || null });
      };

      socket.setTimeout(timeout);
      socket.once('connect', () => {
        socket.setTimeout(320);
      });
      socket.on('data', (chunk) => {
        banner += chunk.toString('utf8');
        if (banner.includes('\n') || banner.length > 200) done(banner.startsWith('SSH-'));
      });
      socket.on('timeout', () => done(banner.startsWith('SSH-')));
      socket.on('error', () => done(false));
      socket.on('close', () => done(banner.startsWith('SSH-')));
      socket.connect(22, host);
    });
  }

  async function reverseName(host) {
    try {
      const names = await Promise.race([
        dns.promises.reverse(host),
        new Promise((resolve) => setTimeout(() => resolve([]), 400)),
      ]);
      return names && names[0] ? String(names[0]).replace(/\.$/, '') : null;
    } catch (_) {
      return null;
    }
  }

  async function pool(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
      for (;;) {
        const i = index++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async function scanLocalNetwork() {
    const now = Date.now();
    if (scanCache && now - scanCache.at < SCAN_TTL_MS) return scanCache.data;

    const { targets, subnets } = scanTargets();
    const own = new Set(subnets.map((s) => s.address));

    const probed = await pool(targets, 96, (host) => probeSsh(host));
    const open = probed.filter((r) => r.open);

    const hosts = await pool(open, 24, async (r) => ({
      host: r.host,
      port: 22,
      banner: r.banner,
      name: await reverseName(r.host),
      self: own.has(r.host),
    }));

    hosts.sort((a, b) => ipToInt(a.host) - ipToInt(b.host));

    const data = {
      hosts,
      scanned: targets.length,
      subnets: subnets.map((s) => ({ iface: s.iface, cidr: s.cidr, address: s.address })),
      at: now,
    };
    scanCache = { at: now, data };
    return data;
  }

  return { scanLocalNetwork, localSubnets };
}

module.exports = { createDiscovery };
