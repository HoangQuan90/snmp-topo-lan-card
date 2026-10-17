/**
 * snmp-topo-lan-card v1.0.0
 * Topo LAN dạng cây: ISP → pfSense → switch lõi → các switch khác → cổng có thiết bị
 * v1.0.0 (bản phát hành đầu tiên): kéo thả được cả switch, vùng sắp xếp phủ toàn bộ sơ đồ trong card, node gọn hơn (dòng 2 chỉ IP) và rộng hơn.
 * Dữ liệu: integration SNMP Switch Manager (switch / cổng / băng thông), sensor SNMP YAML cho
 * switch không thêm được vào integration, và sensor pfSense (ISP / WAN).
 * Dựa trên unifi-topo-wifi-card v0.11.0: giữ nguyên flow, bố cục kéo thả, cảnh báo, editor.
 */
const CARD_VERSION = '1.0.0';
const CARD_TAG = 'snmp-topo-lan-card';
const STYLES = ['glass', 'neon'];       // glass: theo theme HA (sáng/tối) | neon: nền tối cố định
const STYLE_KEY = 'utwc-style';         // localStorage: lựa chọn giao diện, dùng chung cho mọi card

// ───────────────────────── Nạp Lit ─────────────────────────
// Lấy LitElement từ chính HA frontend (không cần bundler).
if (!customElements.get('ha-panel-lovelace') && !customElements.get('hui-view')) {
  await Promise.race([customElements.whenDefined('ha-panel-lovelace'), new Promise((r) => setTimeout(r, 3000))]);
}
const HaLit = Object.getPrototypeOf(
  customElements.get('ha-panel-lovelace') || customElements.get('hui-view') || HTMLElement
);
let LitBase = HaLit;
let html = HaLit.prototype.html;
let css = HaLit.prototype.css;
if (!html || !css) {
  // Dự phòng: HA bản mới không còn gắn html/css lên LitElement → nạp Lit riêng.
  ({ LitElement: LitBase, html, css } = await import(
    'https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm'
  ));
}

// ───────────────────────── Hằng số & helper ─────────────────────────
const BAD_STATES = ['unavailable', 'unknown', 'none', ''];
const IDLE_BPS = 200; // dưới ngưỡng này coi là "idle" (dùng cho hide_idle)

// Bố cục mặc định của 3 node đầu: x (px, từ mép trái vùng hub), dy (px, lệch so với tâm dọc cột AP)
const HUB_NW = 200;      // bề rộng cố định của node ISP / pfSense / Controller
const COL_NW = 230;      // bề rộng node cổng thiết bị trong cột (dùng để đặt cột của switch lõi)
const DEFAULT_LAYOUT = {
  isp: { x: 0, dy: 0 },
  pf: { x: 284, dy: 0 },
  ctrl: { x: 568, dy: 0 },
};
// Chế độ dọc (orientation: vertical): dx = lệch ngang so với tâm, y = toạ độ từ mép trên vùng hub
const DEFAULT_LAYOUT_V = {
  isp: { dx: 0, y: 0 },
  pf: { dx: 0, y: 120 },
  ctrl: { dx: 0, y: 250 },
};
const EDIT_MIN_H = 340;  // chiều cao tối thiểu của vùng sắp xếp khi card để height: auto
const NODE_H_V = 76;     // chiều cao ước lượng của 1 node hub (chế độ dọc)
// Cảnh báo lưu lượng: sàn theo tầng (Mbps, tải xuống + tải lên) và hệ số so với trung bình ngày hôm qua
const DEFAULT_ALERTS = {
  enabled: true,
  factor_warn: 2,
  factor_crit: 4,
  floors: {
    infra: { warn: 20, crit: 100 }, // ISP, pfSense, switch lõi
    sw: { warn: 10, crit: 50 },     // switch khác (theo đường uplink)
    port: { warn: 5, crit: 30 },    // cổng có thiết bị
  },
};
const ALERT_TIERS = Object.keys(DEFAULT_ALERTS.floors);
// Tự động xoay AP: tự đổi AP đang mở danh sách client sau mỗi vài giây
const DEFAULT_AUTO = { mode: 'single', count: 2, interval: 6, skip_empty: true, pause_on_tap: 20 };
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Quy mọi đơn vị tốc độ về bit/s
const UNIT_TO_BPS = {
  'bit/s': 1, 'kbit/s': 1e3, 'Mbit/s': 1e6, 'Gbit/s': 1e9,
  'B/s': 8, 'kB/s': 8e3, 'KiB/s': 8192,
  'MB/s': 8e6, 'MiB/s': 8388608, 'GB/s': 8e9,
};

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Giá trị số của entity, null nếu unavailable/unknown
const num = (st) => {
  if (!st || BAD_STATES.includes(st.state)) return null;
  const v = Number(st.state);
  return Number.isFinite(v) ? v : null;
};

// Tốc độ (bit/s) của sensor, dựa vào unit_of_measurement
const toBps = (st) => {
  const v = num(st);
  if (v === null) return null;
  const k = UNIT_TO_BPS[st.attributes && st.attributes.unit_of_measurement];
  return k ? v * k : null;
};

const fmtRate = (bps) => {
  if (bps == null) return '–';
  if (bps < 1e3) return `${Math.round(bps)} bps`;
  if (bps < 1e6) return `${(bps / 1e3).toFixed(bps < 1e4 ? 2 : 1)} Kbps`;
  if (bps < 1e9) return `${(bps / 1e6).toFixed(bps < 1e7 ? 2 : 1)} Mbps`;
  return `${(bps / 1e9).toFixed(2)} Gbps`;
};

// Độ dày / tốc độ hạt chạy / độ sáng của đường nối theo băng thông (thang log:
// 100 bps → nhỏ nhất, 100 Mbps → lớn nhất)
const flowVars = (bps) => {
  if (!(bps > 100)) return '--w:2px;--d:0s;--o:.4';
  const t = Math.round(Math.min(1, Math.max(0, (Math.log10(bps) - 2) / 6)) * 20) / 20;
  return `--w:${(2 + t * 4).toFixed(1)}px;--d:${(2.6 - t * 2).toFixed(2)}s;--o:${(0.5 + t * 0.5).toFixed(2)}`;
};

const SNMP_PLATFORM = 'snmp_switch_manager';

// Attribute của integration có khoảng trắng / viết hoa ("Port Type", "Oper") → thử vài cách viết
const g = (a, k) => {
  for (const key of [k, k.toLowerCase(), k.toLowerCase().replace(/ /g, '_')]) {
    if (a && a[key] != null) return a[key];
  }
  return undefined;
};

// Chuẩn hoá tên cổng để so khớp: "GigabitEthernet1/0/13" ≡ "Gi1/0/13"
const normPort = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '')
  .replace(/^tengigabitethernet/, 'te').replace(/^twogigabitethernet/, 'tw')
  .replace(/^gigabitethernet/, 'gi').replace(/^fastethernet/, 'fa').replace(/^port-channel/, 'po');

// Khoá "switch:cổng" (hoặc chỉ "cổng") dùng cho port_names / exclude_ports
const pkey = (s) => {
  const t = String(s), i = t.indexOf(':');
  return i < 0 ? normPort(t) : `${t.slice(0, i).trim().toLowerCase()}:${normPort(t.slice(i + 1))}`;
};

// Mô tả cổng còn là tên mặc định ("GigabitEthernet1/0/13") thì coi như chưa đặt tên
const isDefaultAlias = (alias, name) => {
  const a = normPort(alias);
  return !a || a === normPort(name) || /^(gi|fa|te|tw|po|eth)\d[\d/.]*$/.test(a);
};

// "FRIGATE-192.168.1.x" → tên "FRIGATE" + IP "192.168.1.x"
const IP_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const splitAlias = (alias) => {
  const m = IP_RE.exec(alias);
  if (!m) return { name: alias.trim(), ip: '' };
  const name = alias.replace(m[0], '').replace(/^[\s\-_:@()]+|[\s\-_:@()]+$/g, '').trim();
  return { name: name || alias.trim(), ip: m[1] };
};

// port_names: "tên | IP" (chuỗi) hoặc { name, ip, icon }
const parseNm = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return { name: String(v.name || ''), ip: String(v.ip || ''), icon: v.icon };
  const [a, b] = String(v).split('|').map((x) => x.trim());
  return { name: a || '', ip: b || '' };
};

const portIcon = (s) =>
  /cam|nvr|frigate|chuong|chu[oô]ng|doorbell/i.test(s) ? 'mdi:cctv'
  : /\bnas\b|hass|server|proxmox|pve|\bvm\b|docker/i.test(s) ? 'mdi:server'
  : /\bap\b|unifi|wifi|wlan/i.test(s) ? 'mdi:access-point'
  : /hub|switch|\bsw\b|sg\d|c1000|sf\d/i.test(s) ? 'mdi:lan-connect'
  : /\bpc\b|desktop|laptop|notebook/i.test(s) ? 'mdi:laptop'
  : 'mdi:ethernet';

// Mức cảnh báo: 0 = bình thường, 1 = vàng, 2 = đỏ. Chỉ sáng khi vượt CẢ mức sàn của tầng
// lẫn (trung bình hôm qua × hệ số); chưa có lịch sử (base = null) thì chỉ so với mức sàn.
const alertLevel = (rate, base, floor, A) => {
  if (rate == null) return 0;
  const warn = Math.max(floor.warn * 1e6, base != null ? base * A.factor_warn : 0);
  const crit = Math.max(floor.crit * 1e6, base != null ? base * A.factor_crit : 0);
  return rate >= crit ? 2 : rate >= warn ? 1 : 0;
};

// Trung bình theo thời gian (bit/s) của một chuỗi trạng thái trong [t0, t1] (giây);
// trạng thái không phải số (unavailable/unknown) không được tính vào thời gian.
const tsOf = (p) => {
  const v = p.lu != null ? p.lu : p.lc != null ? p.lc : Date.parse(p.last_updated) / 1000;
  return Number.isFinite(v) ? v : 0;
};
const avgSeries = (pts, t0, t1, k) => {
  let sum = 0, span = 0;
  for (let i = 0; i < pts.length; i++) {
    const ts = Math.max(t0, tsOf(pts[i]));
    const te = i + 1 < pts.length ? Math.min(t1, tsOf(pts[i + 1])) : t1;
    const v = Number(pts[i].s != null ? pts[i].s : pts[i].state);
    if (Number.isFinite(v) && te > ts) { sum += v * k * (te - ts); span += te - ts; }
  }
  return span ? sum / span : null;
};

// ───────────────────────── Card ─────────────────────────
class SnmpTopoLanCard extends LitBase {
  static get properties() {
    return {
      _config: { state: true },
      _tree: { state: true },
      _selected: { state: true },
      _zoom: { state: true },
      _style: { state: true },
      _layout: { state: true },
      _layoutV: { state: true },
      _swOff: { state: true },
      _swOffV: { state: true },
      _coreOpen: { state: true },
      _baseVer: { state: true },
      _autoOn: { state: true },
      _fadeSeq: { state: true },
      _searchOpen: { state: true },
      _q: { state: true },
      _edit: { state: true },
      _error: { state: true },
    };
  }

  constructor() {
    super();
    this._selected = [];        // các AP đang chọn, theo thứ tự → cột client 1, 2, …
    this._zoom = 1;
    this._style = 'glass';
    this._curCols = [];
    this._layout = clone(DEFAULT_LAYOUT);
    this._layoutV = clone(DEFAULT_LAYOUT_V);
    this._swOff = {};           // độ lệch {dx, dy} của từng switch so với vị trí tự động (chế độ ngang)
    this._swOffV = {};          // như trên, chế độ dọc
    this._noTap = false;        // true ngay sau khi kéo → bỏ qua click sinh ra khi thả chuột
    this._coreOpen = false;     // cột cổng của switch lõi: mở / đóng độc lập, chỉ đổi khi bấm vào node lõi
    this._edit = false;
    this._layoutLoaded = false;
    this._drag = null;
    this._geom = { minX: 0, w: 0 };
    this._linkKey = '';
    this._paths = new Map();
    this._ro = null;
    this._obsEl = null;
    this._reg = null;           // cache registry
    this._loading = false;
    this._regAt = 0;
    this._last = 0;
    this._timer = null;
    this._sig = null;
    this._base = new Map();       // entity_id → trung bình ngày hôm qua (bit/s) hoặc null
    this._baseDay = '';
    this._baseTried = new Set();
    this._baseLoading = false;
    this._baseRetryAt = 0;
    this._baseVer = 0;
    this._autoOn = false;
    this._autoTimer = null;
    this._autoIdx = 0;            // nhóm AP kế tiếp sẽ được mở
    this._autoPausedUntil = 0;    // thời điểm (ms) auto chạy tiếp sau khi người dùng tự bấm
    this._fadeSeq = 0;
    this._hist = { down: [], up: [] }; // lịch sử tổng tốc độ cho đồ thị nhỏ (mỗi 5 giây, tối đa 60 điểm)
    this._histAt = 0;
    this._searchOpen = false;
    this._q = '';
    this._svgEl = null;           // svg đang giữ các path (đổi svg → bỏ cache path)
    this._raf = 0;                // rAF gộp việc vẽ lại đường nối
    this._io = null;              // IntersectionObserver: tạm dừng animation khi card ngoài màn hình
    this._regRetryAt = 0;         // lỗi registry → chờ tới mốc này mới thử lại
    this._missing = new Map();    // tracker chưa có trong registry → thời điểm hết hạn bỏ qua (ms)
    this._badLogos = new Set();   // đường dẫn logo bị lỗi → dùng icon mdi
  }

  static getConfigElement() { return document.createElement(EDITOR_TAG); }

  static getStubConfig() {
    return {
      title: 'Mạng LAN',
      orientation: 'vertical',
      flow_style: 'dash',
      transparent: true,
      blur: 6,
      isp: { name: 'Viettel' },
      pfsense: { name: 'pfSense' },
      core: { switch: 'SW-CORE' },
    };
  }

  // Masonry view dùng giá trị này để xếp cột: có chiều cao cố định thì báo đúng chiều cao (1 đơn vị ≈ 50px)
  getCardSize() { return this._fixedHeight() ? Math.max(1, Math.ceil(this._fixedHeight() / 50)) : 6; }

  // Sections view: 'full' ép card rộng đúng cả section (người dùng vẫn chỉnh được trong UI)
  getGridOptions() { return { columns: 'full', rows: 'auto', min_columns: 3 }; }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._timer);
    this._timer = null;
    this._autoStop();
    if (this._ro) { this._ro.disconnect(); this._obsEl = null; this._obsSc = null; }
    if (this._io) this._io.disconnect();
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  // ── Config ──
  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Cấu hình card không hợp lệ');
    const ID = /^[a-z_]+\.[a-z0-9_]+$/;
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const ids = (where, v) => {
      for (const e of list(v)) {
        if (typeof e !== 'string' || !ID.test(e)) {
          throw new Error(`${where}: "${e}" không phải entity_id hợp lệ (ví dụ sensor.ten_entity)`);
        }
      }
    };
    const str = (where, v) => {
      if (v != null && typeof v !== 'string') throw new Error(`${where} phải là chuỗi`);
    };
    const port = (where, v) => {
      if (v != null && typeof v !== 'string' && typeof v !== 'number') throw new Error(`${where} phải là tên cổng (ví dụ Gi1/0/13)`);
    };
    for (const [sec, key] of [
      ['isp', 'status'], ['isp', 'delay'], ['isp', 'loss'], ['wan', 'down'], ['wan', 'up'],
      ['pfsense', 'cpu'], ['pfsense', 'ram'], ['pfsense', 'states'],
      ['speedtest', 'down'], ['speedtest', 'up'], ['speedtest', 'ping'],
    ]) ids(`${sec}.${key}`, config[sec] && config[sec][key]);
    for (const sec of ['isp', 'pfsense']) {
      str(`${sec}.logo`, config[sec] && config[sec].logo);
      str(`${sec}.ip`, config[sec] && config[sec].ip);
    }

    const C = config.core;
    if (!isObj(C) || typeof C.switch !== 'string' || !C.switch.trim()) {
      throw new Error('core.switch là bắt buộc: tên switch lõi trong HA (ví dụ SW-CORE)');
    }
    for (const k of ['name', 'ip', 'logo']) str(`core.${k}`, C[k]);
    for (const p of list(C.ports)) port('core.ports', p);

    if (config.links != null) {
      if (!Array.isArray(config.links)) throw new Error('links phải là một danh sách');
      config.links.forEach((L, i) => {
        if (!isObj(L)) throw new Error(`links[${i}] phải là một khối cấu hình`);
        for (const k of ['parent', 'child', 'child_ip', 'logo']) str(`links[${i}].${k}`, L[k]);
        for (const k of ['parent_port', 'child_port']) port(`links[${i}].${k}`, L[k]);
        for (const k of ['down', 'up', 'status']) ids(`links[${i}].${k}`, L[k]);
      });
    }
    if (config.switches != null) {
      if (!Array.isArray(config.switches)) throw new Error('switches phải là một danh sách');
      config.switches.forEach((S, i) => {
        if (!isObj(S)) throw new Error(`switches[${i}] phải là một khối cấu hình`);
        for (const k of ['name', 'model', 'ip', 'logo']) str(`switches[${i}].${k}`, S[k]);
      });
    }
    if (config.port_names != null && !isObj(config.port_names)) {
      throw new Error('port_names phải là map {"switch:cổng": "tên | IP"}');
    }
    str('switch_logo', config.switch_logo);
    if (config.max_ports != null && !(Number.isInteger(config.max_ports) && config.max_ports > 0)) {
      throw new Error('max_ports phải là số nguyên dương');
    }
    if (config.height != null && config.height !== 'auto' &&
        !(typeof config.height === 'number' && config.height >= 100 && config.height <= 2000)) {
      throw new Error("height phải là số px từ 100 đến 2000, hoặc 'auto'");
    }
    if (config.client_columns != null &&
        !(Number.isInteger(config.client_columns) && config.client_columns >= 1 && config.client_columns <= 3)) {
      throw new Error('client_columns phải là số nguyên từ 1 đến 3');
    }
    if (config.zoom != null && !(typeof config.zoom === 'number' && config.zoom >= 0.3 && config.zoom <= 1.6)) {
      throw new Error('zoom phải là số từ 0.3 đến 1.6');
    }
    str('layout_id', config.layout_id);
    str('subtitle', config.subtitle);
    if (config.wheel_zoom != null && !['ctrl', 'always'].includes(config.wheel_zoom)) {
      throw new Error("wheel_zoom phải là 'ctrl' hoặc 'always'");
    }
    if (config.orientation != null && !['horizontal', 'vertical'].includes(config.orientation)) {
      throw new Error("orientation phải là 'horizontal' hoặc 'vertical'");
    }
    if (config.flow_style != null && !['dash', 'galaxy'].includes(config.flow_style)) {
      throw new Error("flow_style phải là 'dash' hoặc 'galaxy'");
    }
    if (config.style != null && !STYLES.includes(config.style)) {
      throw new Error("style phải là 'glass' hoặc 'neon'");
    }
    if (config.sort_clients != null && !['port', 'name', 'traffic'].includes(config.sort_clients)) {
      throw new Error("sort_clients phải là 'port', 'name' hoặc 'traffic'");
    }
    for (const k of ['style_toggle', 'hide_scrollbar', 'transparent', 'hide_idle', 'show_down_ports',
      'link_labels', 'swap_rx_tx', 'layout_edit', 'show_zoom']) {
      if (config[k] != null && typeof config[k] !== 'boolean') throw new Error(`${k} phải là true hoặc false`);
    }
    if (config.node_blur != null && !(typeof config.node_blur === 'number' && config.node_blur >= 0 && config.node_blur <= 12)) {
      throw new Error('node_blur phải là số từ 0 đến 12 (px)');
    }
    if (config.node_opacity != null && !(typeof config.node_opacity === 'number' && config.node_opacity >= 0 && config.node_opacity <= 100)) {
      throw new Error('node_opacity phải là số từ 0 đến 100 (%)');
    }
    if (config.blur != null && !(typeof config.blur === 'number' && config.blur >= 0 && config.blur <= 20)) {
      throw new Error('blur phải là số từ 0 đến 20 (px)');
    }
    if (config.active_threshold_bps != null &&
        !(typeof config.active_threshold_bps === 'number' && config.active_threshold_bps >= 0)) {
      throw new Error('active_threshold_bps phải là số bps lớn hơn hoặc bằng 0');
    }
    if (config.auto != null) {
      const U = config.auto;
      if (!isObj(U)) throw new Error('auto phải là một khối cấu hình');
      if (U.mode != null && !['single', 'multi'].includes(U.mode)) throw new Error("auto.mode phải là 'single' hoặc 'multi'");
      if (U.count != null && !(Number.isInteger(U.count) && U.count >= 1 && U.count <= 3)) throw new Error('auto.count phải là số nguyên từ 1 đến 3');
      if (U.interval != null && !(typeof U.interval === 'number' && U.interval >= 2 && U.interval <= 60)) throw new Error('auto.interval phải là số giây từ 2 đến 60');
      if (U.skip_empty != null && typeof U.skip_empty !== 'boolean') throw new Error('auto.skip_empty phải là true hoặc false');
      if (U.pause_on_tap != null && !(typeof U.pause_on_tap === 'number' && U.pause_on_tap >= 0 && U.pause_on_tap <= 600)) throw new Error('auto.pause_on_tap phải là số giây từ 0 đến 600');
    }
    if (config.alerts != null) {
      const A = config.alerts;
      if (!isObj(A)) throw new Error('alerts phải là một khối cấu hình');
      if (A.enabled != null && typeof A.enabled !== 'boolean') throw new Error('alerts.enabled phải là true hoặc false');
      for (const k of ['factor_warn', 'factor_crit']) {
        if (A[k] != null && !(typeof A[k] === 'number' && A[k] > 0)) throw new Error(`alerts.${k} phải là số lớn hơn 0`);
      }
      if ((A.factor_crit != null ? A.factor_crit : DEFAULT_ALERTS.factor_crit) <
          (A.factor_warn != null ? A.factor_warn : DEFAULT_ALERTS.factor_warn)) {
        throw new Error('alerts.factor_crit phải lớn hơn hoặc bằng factor_warn');
      }
      for (const tier of ALERT_TIERS) {
        const f = A.floors && A.floors[tier];
        if (f == null) continue;
        for (const k of ['warn', 'crit']) {
          if (f[k] != null && !(typeof f[k] === 'number' && f[k] > 0)) throw new Error(`alerts.floors.${tier}.${k} phải là số Mbps lớn hơn 0`);
        }
        const d = DEFAULT_ALERTS.floors[tier];
        if ((f.crit != null ? f.crit : d.crit) < (f.warn != null ? f.warn : d.warn)) {
          throw new Error(`alerts.floors.${tier}: crit phải lớn hơn hoặc bằng warn`);
        }
      }
    }
    this._config = {
      orientation: 'horizontal',
      flow_style: 'dash',
      style: 'glass',          // glass | neon
      style_toggle: true,      // hiện nút đổi giao diện ở header
      hide_scrollbar: true,
      subtitle: 'LAN Topology',
      node_blur: 0,
      node_opacity: 80,
      transparent: true,
      blur: 6,
      max_ports: 24,               // số cổng tối đa hiện cho mỗi switch
      sort_clients: 'port',        // 'port' (theo số cổng) | 'name' | 'traffic' (nhảy theo lưu lượng)
      active_threshold_bps: 2000,  // dưới ngưỡng này đường nối đứng yên, không chạy animation
      hide_idle: false,
      show_down_ports: false,      // true: hiện cả cổng không có link
      link_labels: true,           // nhãn ↓ ↑ trên đường nối giữa các switch
      client_columns: 2,           // số switch mở danh sách cổng cùng lúc
      show_zoom: true,
      wheel_zoom: 'ctrl',
      layout_edit: true,
      swap_rx_tx: false,           // true nếu ↓ ↑ bị ngược chiều
      exclude_switches: [],
      exclude_ports: [],
      port_names: {},
      links: [],
      switches: [],
      ...config,
    };
    const A = config.alerts || {}, F = A.floors || {};
    this._config.alerts = { ...DEFAULT_ALERTS, ...A, floors: {} };
    for (const tier of ALERT_TIERS) this._config.alerts.floors[tier] = { ...DEFAULT_ALERTS.floors[tier], ...(F[tier] || {}) };
    this._config.auto = { ...DEFAULT_AUTO, ...(config.auto || {}) };
    this._style = this._resolveStyle();
    this._zoom = config.zoom != null ? config.zoom : 1;
    this._selected = this._selected.slice(-this._config.client_columns);
    this._layoutLoaded = false;
    this._sig = null;
    if (this._autoOn) this._autoStart(); // áp dụng interval mới
    if (this._hass) this._tick();
  }

  // ── Nhận hass: KHÔNG render mỗi lần hass đổi, chỉ tính lại tối đa 1 lần/giây ──
  set hass(hass) {
    this._hass = hass;
    const wait = 1000 - (Date.now() - this._last);
    if (wait <= 0) this._tick();
    else if (!this._timer) {
      this._timer = setTimeout(() => { this._timer = null; this._tick(); }, wait);
    }
  }

  // ── Tải registry một lần: gom entity của integration SNMP Switch Manager theo thiết bị (= switch) ──
  async _loadRegistries() {
    if (this._loading || !this._hass) return;
    this._loading = true;
    try {
      const [devs, ents] = await Promise.all([
        this._hass.callWS({ type: 'config/device_registry/list' }),
        this._hass.callWS({ type: 'config/entity_registry/list' }),
      ]);
      const dev = new Map(devs.map((d) => [d.id, d]));
      const out = new Map();
      for (const e of ents) {
        if (e.platform !== SNMP_PLATFORM || e.disabled_by || !e.device_id) continue;
        let info = out.get(e.device_id);
        if (!info) {
          const d = dev.get(e.device_id) || {};
          const full = String(d.name_by_user || d.name || e.device_id);
          const names = new Set();
          for (const n of [d.name_by_user, d.name]) {
            if (!n) continue;
            const l = String(n).toLowerCase();
            names.add(l);
            names.add(l.split('.')[0]);   // "sw-core.home.lan" → "sw-core"
          }
          info = {
            id: e.device_id, model: d.model || '', names: [...names], ents: [],
            name: /^\d+\.\d+/.test(full) ? full : full.split('.')[0],
          };
          out.set(e.device_id, info);
        }
        info.ents.push(e.entity_id);
      }
      this._reg = { devs: out };
      this._error = null;
    } catch (err) {
      this._error = `Không đọc được registry của HA: ${(err && err.message) || err}`;
      this._regRetryAt = Date.now() + 30000; // lỗi → chờ 30 giây rồi mới thử lại
      console.warn(`[${CARD_TAG}]`, this._error);
    } finally {
      this._loading = false;
      this._regAt = Date.now();
    }
    if (this._reg) this._tick();
  }

  // ── Dựng cây dữ liệu (thuần dữ liệu, không đụng DOM) ──
  // Quy ước chiều: ↓ = hướng từ pfSense / switch lõi đi xuống thiết bị.
  //   cổng phía switch cha (và cổng có thiết bị): ↓ = TX, ↑ = RX
  //   cổng phía switch con (hoặc cổng nối lên pfSense): ↓ = RX, ↑ = TX
  _build() {
    const h = this._hass, c = this._config, reg = this._reg;
    const lcs = (a) => new Set(list(a).map((s) => String(s).toLowerCase()));
    const exSw = lcs(c.exclude_switches);
    const exPort = new Set(list(c.exclude_ports).map(pkey));
    const st = (id) => (id ? h.states[id] : undefined);
    const val = (id) => num(st(id));
    const join = (...a) => a.filter(Boolean).join(' · ');
    const thr = c.active_threshold_bps || 0;
    const sum = (ids) => {   // null nếu chưa khai báo hoặc mọi sensor đều unavailable; số âm (derivative reset) → 0
      let s = 0, got = false;
      for (const i of list(ids)) { const v = toBps(st(i)); if (v != null) { s += Math.max(0, v); got = true; } }
      return got ? s : null;
    };
    const stat = (id, ok) => {
      const s = st(id);
      if (!s || BAD_STATES.includes(s.state)) return 'unk';
      return ok.includes(String(s.state).toLowerCase()) ? 'ok' : 'bad';
    };
    const operStat = (id) => stat(id, ['1', 'up', 'on', 'online', 'true']);   // ifOperStatus: 1 = up, 2 = down
    const pr = (p, parentSide) => {   // [down, up] của một cổng (bit/s)
      const rx = p.rx ? Math.max(0, toBps(st(p.rx)) || 0) : 0;
      const tx = p.tx ? Math.max(0, toBps(st(p.tx)) || 0) : 0;
      const [d, u] = parentSide ? [tx, rx] : [rx, tx];
      return c.swap_rx_tx ? [u, d] : [d, u];
    };
    const q = String(this._q || '').trim().toLowerCase(); // ô tìm kiếm: lọc cổng theo tên / IP / số cổng

    // 1) Switch từ integration: switch.* cho trạng thái cổng, sensor throughput cho tốc độ
    const sws = [];
    for (const info of reg.devs.values()) {
      if (info.names.some((n) => exSw.has(n))) continue;
      const ports = new Map();
      const P = (idx) => {
        let p = ports.get(idx);
        if (!p) { p = { idx }; ports.set(idx, p); }
        return p;
      };
      for (const id of info.ents) {
        const s = h.states[id];
        if (!s) continue;
        const a = s.attributes || {};
        if (id.startsWith('switch.')) {
          const idx = Number(g(a, 'Index'));
          if (!Number.isFinite(idx)) continue;
          const p = P(idx);
          p.sw = id;
          p.name = String(g(a, 'Name') || p.name || '');
          p.alias = String(g(a, 'Alias') || '');
          p.oper = String(g(a, 'Oper') || '').toLowerCase();
          p.speed = String(g(a, 'Speed') || '');
          p.type = String(g(a, 'Port Type') || '').toLowerCase();
        } else if (id.startsWith('sensor.')) {
          const dir = a.direction === 'rx' || a.direction === 'tx' ? a.direction : (/_(rx|tx)_throughput$/.exec(id) || [])[1];
          const kind = a.kind || (/_throughput$/.test(id) ? 'throughput' : '');
          const idx = Number(a.if_index);
          if (kind !== 'throughput' || !dir || !Number.isFinite(idx)) continue;
          const p = P(idx);
          p[dir] = id;
          if (!p.name) {
            // Tên cổng lấy từ tên sensor, bỏ đuôi "RX Throughput" và tiền tố tên switch, giữ nguyên cả chữ
            // ("gigabitEthernet 1/0/3") để khớp với port_names / links như các switch khác.
            let fn = String(a.friendly_name || '').replace(/\s+(?:RX|TX)\s+Throughput$/i, '').trim();
            for (const n of [info.name, ...info.names]) {
              const pre = `${String(n || '').toLowerCase()} `;
              if (pre.trim() && fn.toLowerCase().startsWith(pre)) { fn = fn.slice(pre.length).trim(); break; }
            }
            const m = /([A-Za-z-]+ ?\d+(?:\/\d+)*)$/.exec(fn);
            p.name = m ? m[1] : fn;
          }
        }
      }
      sws.push({ key: info.id, name: info.name, model: info.model, names: info.names, ports, manual: false });
    }
    // Switch thêm tay (không có trong integration, ví dụ SG2210P dùng sensor YAML)
    for (const m of list(c.switches)) {
      if (!m || !m.name || exSw.has(String(m.name).toLowerCase())) continue;
      const nm = String(m.name);
      sws.push({ key: `m:${nm}`, name: nm, model: m.model || '', ip: m.ip || '', logo: m.logo, names: [nm.toLowerCase()], ports: new Map(), manual: true });
    }
    const findSw = (n) => {
      const k = String(n == null ? '' : n).toLowerCase();
      return k ? sws.find((s) => s.names.includes(k) || s.names.includes(k.split('.')[0])) : null;
    };
    const findPort = (s, spec) => {
      if (!s || spec == null || spec === '') return null;
      const want = normPort(spec), tail = (x) => x.replace(/^[a-z-]+/, '');
      for (const p of s.ports.values()) {
        const np = normPort(p.name);
        if (np === want || String(p.idx) === String(spec)) return p;
        if (/^[\d/.]+$/.test(np) && np === tail(want)) return p;   // tên cổng chỉ còn số
      }
      return null;
    };
    const pn = new Map();   // tên / IP đặt tay cho cổng
    for (const [k, v] of Object.entries(c.port_names || {})) pn.set(pkey(k), v);
    const nameOf = (s, p) => {
      const np = normPort(p.name);
      for (const n of s.names) { const v = pn.get(`${n}:${np}`); if (v != null) return v; }
      if (/^[\d/.]+$/.test(np)) {   // tên cổng chỉ còn số ("1/0/3"): so khớp theo phần số của khoá ("gi1/0/3")
        for (const n of s.names) {
          for (const [k, v] of pn) if (k.startsWith(`${n}:`) && k.slice(n.length + 1).replace(/^[a-z-]+/, '') === np) return v;
        }
      }
      return null;
    };
    const used = new Map();   // cổng dùng làm uplink → không hiện như cổng có thiết bị
    const mark = (s, spec) => {
      if (!s || spec == null || spec === '') return;
      const p = findPort(s, spec);
      if (!used.has(s.key)) used.set(s.key, new Set());
      used.get(s.key).add(normPort(p ? p.name : spec));
    };

    // 2) Switch lõi + đường lên pfSense (các cổng LACP được cộng lại)
    const C = c.core;
    const core = findSw(C.switch);
    if (core && C.ip) core.ip = C.ip;
    const corePorts = list(C.ports).map((s) => findPort(core, s)).filter(Boolean);
    list(C.ports).forEach((s) => mark(core, s));
    let cd = 0, cu = 0, cGot = false;
    for (const p of corePorts) {
      if (!(p.rx || p.tx)) continue;
      const [d, u] = pr(p, false);
      cd += d; cu += u; cGot = true;
    }
    const coreUp = {
      down: cGot ? cd : null, up: cGot ? cu : null,
      ids: corePorts.flatMap((p) => [p.rx, p.tx]).filter(Boolean),
      status: corePorts.length && corePorts.every((p) => p.oper && p.oper !== 'up') ? 'bad' : 'ok',
    };

    // 3) Đường nối switch cha → switch con
    const ls = [];
    for (const L of list(c.links)) {
      if (!L) continue;
      const Pn = findSw(L.parent), Cn = findSw(L.child);
      if (!Pn || !Cn || Pn === Cn) continue;
      if (L.child_ip) Cn.ip = L.child_ip;
      mark(Pn, L.parent_port);
      mark(Cn, L.child_port);
      const pp = findPort(Pn, L.parent_port), cp = findPort(Cn, L.child_port);
      let down = null, up = null, ids = [];
      if (list(L.down).length || list(L.up).length) {          // sensor YAML (đã là tốc độ, ↓ = từ switch cha xuống switch con)
        down = sum(L.down); up = sum(L.up);
        ids = [...list(L.down), ...list(L.up)];
      } else if (pp && (pp.rx || pp.tx)) {
        [down, up] = pr(pp, true); ids = [pp.tx, pp.rx];
      } else if (cp && (cp.rx || cp.tx)) {
        [down, up] = pr(cp, false); ids = [cp.rx, cp.tx];
      }
      let status = 'ok';
      if (L.status) status = operStat(L.status);
      else if ((pp && pp.oper && pp.oper !== 'up') || (cp && cp.oper && cp.oper !== 'up')) status = 'bad';
      ls.push({ parent: Pn, child: Cn, lk: { down, up, status, ids: ids.filter(Boolean), statusId: L.status, logo: L.logo } });
    }

    // 4) Cổng có thiết bị của từng switch + node
    let known = 0, online = 0, tDown = 0, tUp = 0;
    const portsOf = (s) => {
      const ex = used.get(s.key) || new Set();
      const out = [];
      for (const p of s.ports.values()) {
        if (p.type && p.type !== 'physical') continue;
        const np = normPort(p.name);
        if (!np || ex.has(np) || exPort.has(np) || s.names.some((n) => exPort.has(`${n}:${np}`))) continue;
        const [down, up] = pr(p, true);
        const isUp = p.oper ? p.oper === 'up' : down + up > thr;
        known++;
        if (isUp) online++;
        tDown += down; tUp += up;
        if (!isUp && !c.show_down_ports) continue;
        const ov = parseNm(nameOf(s, p));
        const al = p.alias && !isDefaultAlias(p.alias, p.name) ? splitAlias(p.alias) : { name: '', ip: '' };
        const label = (ov && ov.name) || al.name || p.name || `#${p.idx}`;
        const ip = (ov && ov.ip) || al.ip;
        const spd = /^(disconnected|unknown|none|n\/a)?$/i.test(p.speed || '') ? '' : p.speed;
        out.push({
          id: `p:${s.key}:${p.idx}`, entity: p.rx || p.sw, label, idx: p.idx,
          icon: (ov && ov.icon) || portIcon(`${label} ${p.alias || ''}`),
          down, up, status: isUp ? 'ok' : 'unk', tier: 'port',
          subs: [ip],                                            // dòng 2 chỉ hiện IP
          tip: join(label !== p.name ? p.name : '', spd),        // tên cổng / tốc độ link: chỉ hiện khi rê chuột
          find: `${label} ${p.name || ''} ${p.alias || ''} ${ip}`, // dùng cho ô tìm kiếm
          bGroups: [[p.rx, p.tx].filter(Boolean)],
        });
      }
      return out;
    };
    const nodeOf = (s, isCore, lk) => {
      const all = portsOf(s);
      let kids = c.hide_idle ? all.filter((k) => k.down + k.up > IDLE_BPS) : all;
      if (q) kids = kids.filter((k) => k.find.toLowerCase().includes(q));
      // Lấy top N theo lưu lượng (không bỏ sót cổng tải nặng), rồi mới sắp theo số cổng / tên cho ổn định
      kids = [...kids].sort((x, y) => y.down + y.up - (x.down + x.up));
      const shown = kids.slice(0, c.max_ports);
      if (c.sort_clients === 'name') shown.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }));
      else if (c.sort_clients !== 'traffic') shown.sort((x, y) => x.idx - y.idx);
      const lnk = isCore ? coreUp : lk;
      const alive = [...s.ports.values()].some((p) => [p.sw, p.rx, p.tx].some((id) => st(id) && !BAD_STATES.includes(st(id).state)));
      let status = s.manual ? (lk ? lk.status : 'ok') : alive ? 'ok' : 'bad';
      if (!s.manual && lnk && lnk.status === 'bad') status = 'bad';
      const upN = all.filter((k) => k.status === 'ok').length;
      return {
        id: isCore ? 'ctrl' : `sw:${s.key}`,
        apId: s.manual ? undefined : isCore ? 'core' : s.key,   // có danh sách cổng → bấm để mở
        label: isCore ? (C.name || s.name) : s.name,
        icon: isCore ? 'mdi:router-network' : 'mdi:lan-connect',
        logo: isCore ? C.logo : (lk && lk.logo) || s.logo || c.switch_logo,
        entity: s.manual && lk ? lk.statusId : undefined,
        status, tier: isCore ? 'infra' : 'sw',
        subs: [s.ip || ''],                                      // dòng 2 chỉ hiện IP
        tip: join(s.model, s.manual ? '' : `${upN} cổng đang up`), // model / số cổng up: chỉ hiện khi rê chuột
        down: lnk ? lnk.down : null, up: lnk ? lnk.up : null,
        bGroups: [lnk && lnk.ids ? lnk.ids : [], all.flatMap((k) => k.bGroups[0])].filter((x) => x.length),
        kids: shown, hidden: Math.max(0, kids.length - c.max_ports),
      };
    };

    const ctrl = core ? nodeOf(core, true, null) : {
      id: 'ctrl', label: C.name || C.switch, icon: 'mdi:router-network', status: 'bad',
      subs: ['Không thấy switch này trong integration'], kids: [], hidden: 0, tier: 'infra',
    };

    // 5) Sắp các switch còn lại theo cây (cha đứng trước con) để đường nối giữa các cột không chéo nhau
    const parentOf = new Map();
    for (const l of ls) if (!parentOf.has(l.child.key)) parentOf.set(l.child.key, l);
    const rest = sws.filter((s) => !core || s.key !== core.key);
    const kidsOf = new Map();
    for (const s of rest) {
      const l = parentOf.get(s.key);
      const pk = l && (!core || l.parent.key !== core.key) ? l.parent.key : '';
      if (!kidsOf.has(pk)) kidsOf.set(pk, []);
      kidsOf.get(pk).push(s);
    }
    for (const arr of kidsOf.values()) arr.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const order = [], seen = new Set();
    const visit = (s, d) => {
      if (seen.has(s.key)) return;
      seen.add(s.key);
      order.push([s, d]);
      for (const k of kidsOf.get(s.key) || []) visit(k, d + 1);
    };
    for (const s of kidsOf.get('') || []) visit(s, 1);
    for (const s of rest) visit(s, 1);   // dự phòng nếu khai báo link bị vòng lặp
    const aps = order.map(([s, d]) => {
      const l = parentOf.get(s.key);
      const n = nodeOf(s, false, l ? l.lk : null);
      n.depth = d;
      n.parentId = l ? (core && l.parent.key === core.key ? 'ctrl' : `sw:${l.parent.key}`) : null;
      n.linkStatus = l ? l.lk.status : 'ok';
      if (!l) n.tip = join(n.tip, 'Chưa khai báo đường nối');
      return n;
    });

    // 6) Các node phía trên (chỉ hiện nếu có khai báo trong config)
    const I = c.isp, P = c.pfsense;
    // Dòng 2 của ISP / pfSense: IP lấy từ entity (ví dụ sensor.wan_public_ip) hoặc ghi cố định (ví dụ 192.168.1.x)
    const ipOf = (v) => {
      if (v == null || v === '') return '';
      const t = String(v);
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(t)) return t;            // IP ghi cố định
      const e = st(t);
      return e && !BAD_STATES.includes(e.state) ? String(e.state) : '';
    };
    const dly = I && val(I.delay), loss = I && val(I.loss);
    const isp = I && {
      id: 'isp', label: I.name || 'ISP', icon: 'mdi:earth', entity: I.status, logo: I.logo,
      status: stat(I.status, ['online', 'up', 'on']),
      subs: [ipOf(I && I.ip)],   // dòng 2 chỉ hiện IP WAN; độ trễ / mất gói chuyển vào tooltip
      tip: join(dly != null && `${dly.toFixed(1)} ms`, loss != null && `${loss}% loss`),
    };
    const cpu = P && val(P.cpu), ram = P && val(P.ram), sts = P && val(P.states);
    const pf = P && {
      id: 'pf', label: P.name || 'pfSense', icon: 'mdi:shield-half-full', logo: P.logo,
      entity: P.cpu || P.ram,
      status: cpu != null || ram != null ? 'ok' : 'unk',
      subs: [ipOf(P && P.ip)],   // dòng 2 chỉ hiện IP; CPU / RAM / state chuyển vào tooltip
      tip: join(
        cpu != null && `CPU ${Math.round(cpu)}%`, ram != null && `RAM ${Math.round(ram)}%`,
        sts != null && `${Math.round(sts)} state`,
      ),
    };
    const wanD = sum(c.wan && c.wan.down), wanU = sum(c.wan && c.wan.up);
    const wanCfg = list(c.wan && c.wan.down).length + list(c.wan && c.wan.up).length;
    const wan = { down: wanD, up: wanU, status: wanCfg && wanD == null && wanU == null ? 'bad' : 'ok' };
    const lan = { down: coreUp.down, up: coreUp.up, status: coreUp.status };   // pfSense → switch lõi

    // Tầng hạ tầng: ISP theo đường WAN, pfSense theo đường lớn hơn (switch lõi đã có rate riêng ở nodeOf)
    const wanR = (wan.down || 0) + (wan.up || 0), lanR = (lan.down || 0) + (lan.up || 0);
    const wanIds = [...list(c.wan && c.wan.down), ...list(c.wan && c.wan.up)];
    const hubAlert = (n, rate, groups) => {
      if (n) { n.tier = 'infra'; n.rate = rate; n.bGroups = groups.filter((x) => x.length); }
    };
    hubAlert(isp, wanR, [wanIds]);
    hubAlert(pf, Math.max(wanR, lanR), [wanIds, coreUp.ids]);

    // Speedtest: kết quả lần đo gần nhất của sensor (down / up thường là Mbit/s, ping là ms)
    const SP = c.speedtest || {};
    const speed = SP.down || SP.up || SP.ping ? {
      down: toBps(st(SP.down)), up: toBps(st(SP.up)), ping: val(SP.ping),
      at: (st(SP.down) || st(SP.up) || st(SP.ping) || {}).last_changed || '',
    } : null;
    // Phân loại để JSON.stringify so sánh được (không có undefined/Set/Map)
    const clean = (n) => n && { ...n, hub: true, subs: n.subs.filter(Boolean) };
    return {
      tree: {
        isp: clean(isp), pf: clean(pf), ctrl: clean(ctrl), wan, lan, aps,
        found: sws.length,
        totals: { online, known, down: tDown, up: tUp, speed },
      },
    };
  }

  // ── Cảnh báo lưu lượng: mức sàn theo tầng + trung bình ngày hôm qua ──
  _rateOf(n) { return n.rate != null ? n.rate : n.down != null ? n.down + n.up : null; }

  // Trung bình hôm qua của node = tổng các sensor trong nhóm; node có 2 nhóm (pfSense) lấy nhóm lớn hơn
  _baselineOf(n) {
    let best = null;
    for (const g of n.bGroups || []) {
      let sum = 0, got = false;
      for (const id of g) {
        const v = this._base.get(id);
        if (v != null) { sum += v; got = true; }
      }
      if (got) best = Math.max(best == null ? 0 : best, sum);
    }
    return best;
  }

  _lvClass(n) {
    const A = this._config.alerts;
    if (!A.enabled || !n.tier) return '';
    const lv = alertLevel(this._rateOf(n), this._baselineOf(n), A.floors[n.tier], A);
    return lv ? `lv${lv}` : '';
  }

  _dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // Lấy lịch sử ngày hôm qua một lần mỗi ngày (có cache localStorage), chỉ lấy thêm entity mới xuất hiện.
  async _ensureBaseline() {
    const A = this._config && this._config.alerts, t = this._tree;
    if (!A || !A.enabled || !t || !this._hass || this._baseLoading || Date.now() < this._baseRetryAt) return;
    const day = this._dayKey(), key = `${CARD_TAG}:base:${day}`;
    if (day !== this._baseDay) {
      this._baseDay = day;
      this._base = new Map();
      this._baseTried = new Set();
      try {
        const c = JSON.parse(localStorage.getItem(key));
        if (c && typeof c === 'object') for (const [id, v] of Object.entries(c)) { this._base.set(id, v); this._baseTried.add(id); }
      } catch (e) { /* bỏ qua */ }
    }
    const want = new Set();
    for (const n of [t.isp, t.pf, t.ctrl, ...t.aps]) {
      for (const g of (n && n.bGroups) || []) g.forEach((id) => want.add(id));
    }
    const need = [...want].filter((id) => !this._baseTried.has(id));
    if (!need.length) return;
    this._baseLoading = true;
    try {
      const failed = await this._fetchBaseline(need);       // id lỗi tạm thời → không đánh dấu đã thử
      need.forEach((id) => { if (!failed.has(id)) this._baseTried.add(id); });
      if (failed.size) this._baseRetryAt = Date.now() + 60000;
      try {
        localStorage.setItem(key, JSON.stringify(Object.fromEntries(this._base)));
        for (let i = localStorage.length - 1; i >= 0; i--) { // dọn cache của các ngày cũ
          const k = localStorage.key(i);
          if (k && k.startsWith(`${CARD_TAG}:base:`) && k !== key) localStorage.removeItem(k);
        }
      } catch (e) { /* bỏ qua */ }
      this._baseVer++; // render lại để áp baseline mới
    } catch (e) {
      this._baseRetryAt = Date.now() + 60000; // lỗi → thử lại sau 1 phút
    } finally {
      this._baseLoading = false;
    }
  }

  // Ưu tiên thống kê theo giờ (nhẹ); sensor không có thống kê thì đọc lịch sử trạng thái.
  async _fetchBaseline(ids) {
    const h = this._hass;
    const failed = new Set();
    const end = new Date(); end.setHours(0, 0, 0, 0);          // 00:00 hôm nay
    const start = new Date(end); start.setDate(start.getDate() - 1); // 00:00 hôm qua
    const t0 = start.getTime() / 1000, t1 = end.getTime() / 1000;
    const kOf = (id) => {
      const st = h.states[id];
      return UNIT_TO_BPS[st && st.attributes && st.attributes.unit_of_measurement];
    };
    const known = ids.filter((id) => kOf(id));
    for (const id of ids) if (!kOf(id)) this._base.set(id, null); // không rõ đơn vị → bỏ qua
    for (let i = 0; i < known.length; i += 30) {
      const chunk = known.slice(i, i + 30);
      let stats = {};
      try {
        stats = (await h.callWS({
          type: 'recorder/statistics_during_period',
          start_time: start.toISOString(), end_time: end.toISOString(),
          statistic_ids: chunk, period: 'hour', types: ['mean'],
        })) || {};
      } catch (e) { stats = {}; }
      const missing = [];
      for (const id of chunk) {
        const vals = (stats[id] || []).map((r) => r.mean).filter(Number.isFinite);
        if (vals.length) this._base.set(id, (vals.reduce((a, b) => a + b, 0) / vals.length) * kOf(id));
        else missing.push(id);
      }
      for (let j = 0; j < missing.length; j += 10) {
        const part = missing.slice(j, j + 10);
        let hist = null;
        try {
          hist = (await h.callWS({
            type: 'history/history_during_period',
            start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: part,
            include_start_time_state: true, significant_changes_only: false,
            minimal_response: true, no_attributes: true,
          })) || {};
        } catch (e) { hist = null; }
        if (!hist) { part.forEach((id) => failed.add(id)); continue; }
        for (const id of part) this._base.set(id, avgSeries(hist[id] || [], t0, t1, kOf(id)));
      }
    }
    return failed;
  }

  // ── Mỗi nhịp: chỉ cập nhật _tree (→ render) khi dữ liệu thực sự đổi ──
  _tick() {
    this._last = Date.now();
    if (!this._hass || !this._config) return;
    if (!this._layoutLoaded) this._loadLayout();
    if (!this._reg) {
      if (Date.now() >= this._regRetryAt) this._loadRegistries();
      return;
    }
    // Có switch / cổng mới sau khi HA đã chạy → nạp lại registry mỗi 10 phút
    if (!this._loading && Date.now() - this._regAt > 600000) this._loadRegistries();
    const { tree } = this._build();
    const now = Date.now();
    if (now - this._histAt >= 5000) {
      this._histAt = now;
      for (const [k, v] of [['down', tree.totals.down], ['up', tree.totals.up]]) {
        this._hist[k].push(v);
        if (this._hist[k].length > 60) this._hist[k].shift();
      }
    }
    const sig = JSON.stringify(tree);
    if (sig !== this._sig) { this._sig = sig; this._tree = tree; }
    this._ensureBaseline();
    if (this._autoOn && !this._selected.length) this._autoAdvance();
  }

  // ── Tương tác ──
  // Chạm AP → chọn/bỏ chọn; mỗi AP đang chọn có một cột client (theo thứ tự chọn).
  // Vượt quá client_columns thì AP chọn sớm nhất bị đóng.
  _tap(n) {
    if (this._noTap) return;         // vừa kéo xong: không chọn / bỏ chọn
    if (n.hub && this._edit) return; // đang sắp xếp: kéo thả, không mở more-info
    if (n.apId === 'core') {   // switch lõi: mở / đóng riêng, không tính vào client_columns, không bị auto / tìm kiếm đụng tới
      this._coreOpen = !this._coreOpen;
      this._writeKey(this._coreKey(), { open: this._coreOpen });
    } else if (n.apId) {
      if (this._autoOn && this._config.auto.pause_on_tap > 0) {
        this._autoPausedUntil = Date.now() + this._config.auto.pause_on_tap * 1000;
      }
      const s = [...this._selected];
      const i = s.indexOf(n.apId);
      if (i >= 0) s.splice(i, 1);
      else {
        s.push(n.apId);
        while (s.length > this._config.client_columns) s.shift();
      }
      this._selected = s;
    } else if (n.entity) {
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: n.entity }, bubbles: true, composed: true,
      }));
    }
  }

  _cols() {
    const t = this._tree;
    if (!t) return [];
    const cols = this._selected.map((id) => t.aps.find((a) => a.apId === id)).filter(Boolean);
    // Chế độ dọc: tất cả client nằm chung 1 hàng, nhóm nào đứng cạnh AP nào thì xếp theo đúng thứ tự AP
    if (this._vertical()) cols.sort((a, b) => t.aps.indexOf(a) - t.aps.indexOf(b));
    return cols;
  }

  // ── Zoom ──
  _setZoom(z) {
    this._zoom = Math.round(Math.min(1.6, Math.max(0.3, z)) * 100) / 100;
  }

  // Chiều cao cố định (px) nếu cấu hình height là số, ngược lại 0 = tự giãn theo nội dung
  _fixedHeight() {
    const h = this._config && this._config.height;
    return typeof h === 'number' ? h : 0;
  }

  // Có chiều cao cố định thì thu nhỏ sao cho vừa cả chiều ngang lẫn chiều dọc (không còn phải cuộn)
  _fit() {
    const sc = this.renderRoot.querySelector('.scroll');
    const tree = this.renderRoot.querySelector('.tree');
    if (!sc || !tree) return;
    tree.style.minWidth = ''; // đo kích thước tự nhiên (chưa giãn ra theo vùng sắp xếp)
    tree.style.minHeight = '';
    if (tree.offsetWidth) {
      const ext = this._coreExtent(tree);
      const tw = Math.max(tree.offsetWidth, ext.r), th = Math.max(tree.offsetHeight, ext.b);
      let z = (sc.clientWidth - 4) / tw;
      if (this._fixedHeight() && th) z = Math.min(z, (sc.clientHeight - 8) / th);
      this._setZoom(Math.min(1, z));
    }
    this._applyZoom();
  }

  // Ctrl + cuộn chuột (hoặc chụm 2 ngón trên touchpad) để zoom
  _wheel(e) {
    if (this._config.wheel_zoom !== 'always' && !e.ctrlKey) return;
    e.preventDefault();
    this._setZoom(this._zoom + Math.max(-0.1, Math.min(0.1, -e.deltaY * 0.002)));
  }

  // scale() không đổi kích thước layout → đặt lại kích thước khung bọc theo tỉ lệ zoom.
  // Chế độ dọc: cây tối thiểu bằng bề rộng khung (để các hàng căn giữa), hàng nào dài hơn
  // thì cây rộng ra và cuộn ngang. Chế độ ngang: giữ kích thước tự nhiên, không giãn
  // (trừ khi đang sắp xếp, xem bên dưới).
  _applyZoom() {
    const sc = this.renderRoot.querySelector('.scroll');
    const tree = this.renderRoot.querySelector('.tree');
    const wrap = this.renderRoot.querySelector('.zwrap');
    if (!sc || !tree || !wrap) return;
    const z = this._zoom;
    tree.style.transform = z === 1 ? '' : `scale(${z})`;
    tree.style.width = '';
    // Chế độ sắp xếp: cây phủ kín khung nhìn để lớp .canvas (vùng kéo thả) rộng / cao bằng card.
    // height cố định → cao đúng phần khung còn lại sau header; height auto → tối thiểu EDIT_MIN_H.
    const fill = this._edit || this._vertical();
    const minW = fill && sc.clientWidth ? sc.clientWidth / z : 0;
    const minH = !this._edit ? 0 : this._fixedHeight() ? Math.max(0, sc.clientHeight - 8) / z : EDIT_MIN_H;
    tree.style.minWidth = minW ? `${minW}px` : '';
    tree.style.minHeight = minH ? `${minH}px` : '';
    // Cột switch lõi nằm ngoài luồng: nới cây ra cho vừa nó (kể cả khi bị kéo đi xa)
    const ext = this._coreExtent(tree);
    if (ext.r > tree.offsetWidth) tree.style.minWidth = `${Math.ceil(ext.r) + 4}px`;
    if (ext.b > tree.offsetHeight) tree.style.minHeight = `${Math.ceil(ext.b) + 4}px`;
    wrap.style.width = `${tree.offsetWidth * z}px`;
    wrap.style.height = `${tree.offsetHeight * z}px`;
  }

  // ── Bố cục 3 node đầu: kéo thả + lưu ──
  // Lưu theo user HA (frontend/set_user_data → đồng bộ giữa các thiết bị của user đó),
  // đồng thời lưu localStorage làm dự phòng.
  _vertical() { return !!this._config && this._config.orientation === 'vertical'; }

  // Bố cục đang dùng theo hướng hiện tại (mỗi hướng lưu riêng)
  _lay() { return this._vertical() ? this._layoutV : this._layout; }

  _layoutKey(vert) {
    const c = this._config;
    return `${CARD_TAG}:layout${vert ? '_v' : ''}:${c.layout_id || c.title || 'default'}`;
  }

  _sanitizeLayout(v, vert) {
    if (!v || typeof v !== 'object') return null;
    const out = clone(vert ? DEFAULT_LAYOUT_V : DEFAULT_LAYOUT);
    const [a, b] = vert ? ['dx', 'y'] : ['x', 'dy'];
    const [aLo, aHi, bLo, bHi] = vert ? [-2000, 2000, 0, 3000] : [0, 4000, -2000, 2000];
    for (const k of Object.keys(out)) {
      const p = v[k];
      if (p && Number.isFinite(p[a]) && Number.isFinite(p[b])) {
        out[k] = { [a]: clamp(p[a], aLo, aHi), [b]: clamp(p[b], bLo, bHi) };
      }
    }
    return out;
  }

  async _readLayout(vert) {
    const key = this._layoutKey(vert);
    let v = null;
    try {
      const r = await this._hass.callWS({ type: 'frontend/get_user_data', key });
      v = r && r.value;
    } catch (e) { /* bỏ qua, thử localStorage */ }
    if (!v) {
      try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { /* bỏ qua */ }
    }
    return this._sanitizeLayout(v, vert);
  }

  async _loadLayout() {
    if (this._layoutLoaded || !this._hass || !this._config) return;
    this._layoutLoaded = true;
    const [h, v, a, oh, ov, co] = await Promise.all([
      this._readLayout(false), this._readLayout(true), this._readKey(this._autoKey()),
      this._readOff(false), this._readOff(true), this._readKey(this._coreKey()),
    ]);
    if (h) this._layout = h;
    if (v) this._layoutV = v;
    if (oh) this._swOff = oh;
    if (ov) this._swOffV = ov;
    if (co && co.open) this._coreOpen = true;
    if (a && typeof a === 'object' && a.on) { this._autoOn = true; this._autoStart(); }
  }

  async _readKey(key) {
    let v = null;
    try {
      const r = await this._hass.callWS({ type: 'frontend/get_user_data', key });
      v = r && r.value;
    } catch (e) { /* bỏ qua, thử localStorage */ }
    if (!v) {
      try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { /* bỏ qua */ }
    }
    return v;
  }

  _writeKey(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* bỏ qua */ }
    if (this._hass) this._hass.callWS({ type: 'frontend/set_user_data', key, value }).catch(() => {});
  }

  // ── Tự động xoay AP ──
  _autoKey() {
    const c = this._config;
    return `${CARD_TAG}:auto:${c.layout_id || c.title || 'default'}`;
  }

  _toggleAuto() {
    this._autoOn = !this._autoOn;
    this._writeKey(this._autoKey(), { on: this._autoOn });
    if (this._autoOn) { this._autoPausedUntil = 0; this._autoAdvance(); this._autoStart(); }
    else this._autoStop();
  }

  _autoStop() { clearTimeout(this._autoTimer); this._autoTimer = null; }

  _autoStart(delayMs) {
    this._autoStop();
    if (!this._autoOn || !this._config) return;
    const ms = delayMs != null ? delayMs : this._config.auto.interval * 1000;
    this._autoTimer = setTimeout(() => this._autoStep(), ms);
  }

  _autoStep() {
    this._autoTimer = null;
    if (!this._autoOn) return;
    const wait = this._autoPausedUntil - Date.now();
    if (wait > 0) { this._autoStart(wait + 50); return; } // người dùng vừa bấm → chờ hết thời gian tạm dừng
    if (!document.hidden) this._autoAdvance();            // tab đang ẩn thì khỏi đổi cho đỡ tốn tài nguyên
    this._autoStart();
  }

  // Mở nhóm AP kế tiếp: 'single' = 1 AP/lần, 'multi' = nhiều AP/lần (không vượt client_columns)
  _autoAdvance() {
    const t = this._tree, A = this._config && this._config.auto;
    if (!t || !A || String(this._q || '').trim()) return; // đang tìm kiếm → giữ nguyên
    const all = t.aps.filter((a) => a.apId);   // switch lõi không tham gia xoay
    const pool = A.skip_empty ? all.filter((a) => a.kids.length || a.hidden) : all;
    let next = [];
    if (pool.length) {
      const size = A.mode === 'multi' ? Math.min(A.count, this._config.client_columns) : 1;
      const groups = [];
      for (let i = 0; i < pool.length; i += size) groups.push(pool.slice(i, i + size));
      next = groups[this._autoIdx % groups.length].map((a) => a.apId);
      this._autoIdx = (this._autoIdx + 1) % groups.length;
    }
    if (next.join('|') !== this._selected.join('|')) {
      this._selected = next;
      this._fadeSeq++; // đổi tên animation để hiệu ứng mờ dần chạy lại
    }
  }

  _saveLayout() {
    const key = this._layoutKey(this._vertical()), value = this._lay();
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* bỏ qua */ }
    if (this._hass) {
      this._hass.callWS({ type: 'frontend/set_user_data', key, value }).catch(() => {});
    }
  }

  _toggleEdit() { this._edit = !this._edit; }

  _resetLayout() {
    if (this._vertical()) { this._layoutV = clone(DEFAULT_LAYOUT_V); this._swOffV = {}; }
    else { this._layout = clone(DEFAULT_LAYOUT); this._swOff = {}; }
    this._saveLayout();
    this._saveOff();
  }

  // ── Độ lệch vị trí của switch (so với vị trí tự động theo cây) ──
  _coreKey() {
    const c = this._config;
    return `${CARD_TAG}:core:${c.layout_id || c.title || 'default'}`;
  }

  // Cột của switch lõi nằm NGOÀI luồng (absolute trong .hub) nên không đẩy / bị đẩy bởi cột của các switch khác.
  // Vị trí mặc định bám theo node lõi: chế độ ngang → bên trái, dưới hàng hub (không đè ISP / pfSense);
  // chế độ dọc → bên phải node. Khi người dùng kéo thì cột được ghim (xem _pin) và không dùng vị trí mặc định này nữa.
  _coreColStyle() {
    const L = this._lay().ctrl;
    return this._vertical()
      ? `left:calc(50% + ${L.dx + HUB_NW / 2 + 24}px);top:${L.y - this._geom.minY}px`
      : `left:${Math.max(0, L.x - this._geom.minX - COL_NW - 24)}px;top:calc(50% + ${L.dy + 56}px)`;
  }

  // ── Cột thiết bị của mọi switch (kể cả lõi): kéo bằng tiêu đề cột để GHIM vị trí ──
  // Cột đã ghim = toạ độ tuyệt đối {x, y} trong .tree (lưu ở _swOff khoá `pin:<apId>`, dùng lại trường dx/dy),
  // nằm ngoài luồng bố cục nên mở / đóng cột khác không làm nó xê dịch hay bị đè. Cột chưa ghim xếp tự động như cũ.
  _pin(key) { return this._off()[`pin:${key}`]; }

  _unpin(key) {
    if (!this._edit || !this._pin(key)) return;
    const next = { ...this._off() };
    delete next[`pin:${key}`];
    if (this._vertical()) this._swOffV = next; else this._swOff = next;
    this._saveOff();
  }

  // Một khối cột: tiêu đề (tay nắm kéo, bấm đúp để bỏ ghim) + danh sách cổng có thiết bị
  _colBlock(a, key, cls, style) {
    return html`<div class="ccol ${cls}" style=${style}>
      <div class="chead" title=${this._edit ? 'Kéo để ghim vị trí, bấm đúp để về vị trí tự động' : ''}
        @pointerdown=${(e) => this._dragStart(e, { id: `pin:${key}`, pin: true }, e.currentTarget.closest('.ccol'))}
        @dblclick=${() => this._unpin(key)}><ha-icon icon="mdi:access-point-network"></ha-icon>${a.label}${this._pin(key) && this._edit ? html` <ha-icon class="pinned" icon="mdi:pin"></ha-icon>` : ''}</div>
      <div class="cnodes">
        ${a.kids.length ? a.kids.map((k) => this._node(k)) : html`<div class="sub">Chưa có thiết bị</div>`}
        ${a.hidden ? html`<div class="sub more">+${a.hidden} thiết bị khác</div>` : ''}
      </div>
    </div>`;
  }

  _pinStyle(p) { return `left:${p.dx}px;top:${p.dy}px`; }

  // Phạm vi (px chưa zoom, từ góc trên trái của .tree) của mọi cột nằm ngoài luồng (core chưa ghim + cột đã ghim),
  // để cây đủ chỗ / cuộn tới được kể cả khi cột bị kéo ra xa.
  _coreExtent(tree) {
    const cols = this.renderRoot.querySelectorAll('.ccol.abs');
    let r = 0, b = 0;
    if (!cols.length) return { r, b };
    const tr = tree.getBoundingClientRect(), z = this._zoom;
    for (const col of cols) {
      const cr = col.getBoundingClientRect();
      r = Math.max(r, (cr.right - tr.left) / z);
      b = Math.max(b, (cr.bottom - tr.top) / z);
    }
    return { r, b };
  }

  _off() { return this._vertical() ? this._swOffV : this._swOff; }

  _offKey(vert) {
    const c = this._config;
    return `${CARD_TAG}:swoff${vert ? '_v' : ''}:${c.layout_id || c.title || 'default'}`;
  }

  _sanitizeOff(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    for (const [k, p] of Object.entries(v)) {
      if (p && Number.isFinite(p.dx) && Number.isFinite(p.dy)) {
        out[k] = { dx: clamp(p.dx, -4000, 4000), dy: clamp(p.dy, -4000, 4000) };
      }
    }
    return out;
  }

  async _readOff(vert) { return this._sanitizeOff(await this._readKey(this._offKey(vert))); }

  _saveOff() { this._writeKey(this._offKey(this._vertical()), this._off()); }

  _swStyle(id) {
    const d = this._drag;
    const o = d && d.id === id ? { dx: d.a, dy: d.b } : this._off()[id];
    return o ? `transform:translate(${o.dx}px,${o.dy}px)` : '';
  }

  // Kích thước vùng hub = bao quanh 3 node. Chế độ sắp xếp dùng toạ độ gốc (minX/minY = 0)
  // để node không nhảy khi kéo; vùng kéo thả thật là lớp .canvas phủ toàn bộ .tree.
  _hubGeom(t) {
    const ids = ['isp', 'pf', 'ctrl'].filter((k) => t[k]);
    const L = this._lay();
    if (this._vertical()) {
      const ys = ids.map((k) => L[k].y);
      const minY = this._edit ? 0 : Math.min(...ys);
      const maxY = Math.max(...ys);
      return { minX: 0, minY, w: 0, h: maxY - minY + NODE_H_V };
    }
    const xs = ids.map((k) => L[k].x);
    const minX = this._edit ? 0 : Math.min(...xs);
    const maxX = Math.max(...xs);
    return { minX, minY: 0, w: maxX - minX + HUB_NW, h: 0 };
  }

  _hubStyle(id) {
    const d = this._drag;
    const live = d && d.id === id;
    const p = this._lay()[id];
    if (this._vertical()) {
      const dx = live ? d.a : p.dx;
      const y = live ? d.b : p.y - this._geom.minY;
      return `width:${HUB_NW}px;left:calc(50% + ${dx}px);top:${y}px`;
    }
    const x = live ? d.a : p.x - this._geom.minX;
    const dy = live ? d.b : p.dy;
    return `width:${HUB_NW}px;left:${x}px;top:calc(50% + ${dy}px)`;
  }

  // Kéo một node trong chế độ sắp xếp: node hub (ISP / pfSense / switch lõi) đổi toạ độ trong .hub,
  // node switch đổi độ lệch translate so với vị trí tự động. Cả hai bị giới hạn bởi mép của .tree
  // (= vùng .canvas phủ toàn bộ sơ đồ), nên vùng kéo luôn theo kích thước card / zoom hiện tại.
  _dragStart(e, n, target) {
    if (!this._edit || e.button > 0) return;
    e.preventDefault();
    const hubNode = !!n.hub, pinCol = !!n.pin, id = n.id;
    const vert = this._vertical();
    const node = target || e.currentTarget;   // tiêu đề cột: kéo cả khối .ccol
    const tree = this.renderRoot.querySelector('.tree');
    if (!tree) return;
    const z = this._zoom;
    const tr = tree.getBoundingClientRect(), nr = node.getBoundingClientRect();
    // Quãng còn kéo được theo 4 hướng (px chưa zoom); luôn cho phép kéo ngược về phía trong
    const lim = {
      l: Math.min(0, (tr.left - nr.left) / z), r: Math.max(0, (tr.right - nr.right) / z),
      t: Math.min(0, (tr.top - nr.top) / z), b: Math.max(0, (tr.bottom - nr.bottom) / z),
    };
    // a = trục ngang (x / dx), b = trục dọc (dy / y); chế độ sắp xếp dùng toạ độ gốc
    let a0, b0;
    if (pinCol) {                       // cột: toạ độ hiện tại trong .tree (kể cả cột đang xếp tự động)
      a0 = (nr.left - tr.left) / z; b0 = (nr.top - tr.top) / z;
    } else if (hubNode) {
      const p = this._lay()[id];
      a0 = vert ? p.dx : p.x; b0 = vert ? p.y : p.dy;
    } else {
      const p = this._off()[id] || { dx: 0, dy: 0 };
      a0 = p.dx; b0 = p.dy;
    }
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    node.setPointerCapture(e.pointerId);
    node.classList.add('dragging');
    const move = (ev) => {
      const da = clamp((ev.clientX - sx) / z, lim.l, lim.r);
      const db = clamp((ev.clientY - sy) / z, lim.t, lim.b);
      if (!moved && Math.hypot(da, db) < 3) return; // chạm nhẹ vẫn là click, không phải kéo
      moved = true;
      const a = a0 + da, b = b0 + db;
      if (pinCol) node.style.transform = `translate(${da}px,${db}px)`;   // chỉ đổi hình ảnh, chưa đụng bố cục
      else if (!hubNode) node.style.transform = `translate(${a}px,${b}px)`;
      else if (vert) { node.style.left = `calc(50% + ${a}px)`; node.style.top = `${b}px`; }
      else { node.style.left = `${a}px`; node.style.top = `calc(50% + ${b}px)`; }
      this._drag = { id, a, b };
      this._scheduleDraw(); // đường nối bám theo node khi đang kéo
    };
    const up = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.classList.remove('dragging');
      const d = this._drag;
      this._drag = null;
      if (!moved || !d) return;
      this._noTap = true; // click sinh ra khi thả chuột không được tính là chọn switch
      setTimeout(() => { this._noTap = false; }, 60);
      if (pinCol) {
        node.style.transform = '';
        const next = { ...this._off(), [id]: { dx: Math.max(0, Math.round(d.a)), dy: Math.max(0, Math.round(d.b)) } };
        if (vert) this._swOffV = next; else this._swOff = next;
        this._saveOff();
      } else if (hubNode) {
        const pos = vert
          ? { dx: Math.round(d.a), y: Math.round(d.b) }
          : { x: Math.round(d.a), dy: Math.round(d.b) };
        const next = { ...this._lay(), [id]: pos };
        if (vert) this._layoutV = next; else this._layout = next;
        this._saveLayout();
      } else {
        const next = { ...this._off(), [id]: { dx: Math.round(d.a), dy: Math.round(d.b) } };
        if (vert) this._swOffV = next; else this._swOff = next;
        this._saveOff();
      }
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated) this.requestUpdate(); // gắn lại ResizeObserver sau khi bị tháo
    if (this._io) this._io.observe(this);
    if (this._autoOn) this._autoStart();
  }

  firstUpdated() {
    this._ro = new ResizeObserver(() => { this._applyZoom(); this._scheduleDraw(); });
    // Card ngoài màn hình → thuộc tính `paused` trên host, CSS dừng toàn bộ animation
    this._io = new IntersectionObserver((es) => this.toggleAttribute('paused', !es[es.length - 1].isIntersecting));
    this._io.observe(this);
  }

  updated() {
    const tree = this.renderRoot.querySelector('.tree');
    const sc = this.renderRoot.querySelector('.scroll');
    if (this._ro && (tree !== this._obsEl || sc !== this._obsSc)) {
      this._ro.disconnect();
      if (tree) this._ro.observe(tree);
      if (sc) this._ro.observe(sc);
      this._obsEl = tree;
      this._obsSc = sc;
    }
    this._applyZoom();
    this._scheduleDraw();
  }

  // ── Đường nối (SVG): ISP→pfSense→Controller→AP→client ──
  // Đo vị trí thật của node trong DOM rồi nối bằng đường cong mềm. Lớp SVG nằm DƯỚI node
  // nên đường có thể chạy xuyên qua node khác mà không che. Path chỉ tạo khi cần, các lần
  // sau chỉ cập nhật thuộc tính nên hạt chạy không bị giật.
  _curve(A, B, vert, side) {
    const cx = (R) => (R.l + R.r) / 2, cy = (R) => (R.t + R.b) / 2;
    if (side) {
      // Ra từ cạnh của switch hướng về phía cột, vào cạnh trái (cột ở bên phải) hoặc cạnh phải (cột ở bên trái)
      // của cổng. Tiếp tuyến luôn nằm ngang nên các đường xoè ra như quạt, kể cả khi cột bị kéo xuống dưới / lên trên switch.
      const right = cx(B) >= cx(A);
      const x1 = right ? A.r : A.l, y1 = cy(A), x2 = right ? B.l : B.r, y2 = cy(B);
      const s = right ? 1 : -1, k = Math.max(40, Math.abs(x2 - x1) / 2);
      return { d: `M${x1} ${y1}C${x1 + s * k} ${y1} ${x2 - s * k} ${y2} ${x2} ${y2}`, vertical: false, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
    }
    let x1, y1, x2, y2, vertical = false;
    if (vert) {
      // Chế độ dọc: nối đáy node trên → đỉnh node dưới (đảo lại nếu node bị kéo lên trên)
      vertical = true; x1 = cx(A); x2 = cx(B);
      if (cy(B) >= cy(A)) { y1 = A.b; y2 = B.t; } else { y1 = A.t; y2 = B.b; }
    } else if (B.l >= A.r - 8) { x1 = A.r; y1 = cy(A); x2 = B.l; y2 = cy(B); }
    else if (B.r <= A.l + 8) { x1 = A.l; y1 = cy(A); x2 = B.r; y2 = cy(B); }
    else {
      vertical = true; x1 = cx(A); x2 = cx(B);
      if (cy(B) >= cy(A)) { y1 = A.b; y2 = B.t; } else { y1 = A.t; y2 = B.b; }
    }
    const m = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2;
    const d = vertical
      ? `M${x1} ${y1}C${x1} ${m} ${x2} ${m} ${x2} ${y2}`
      : `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
    return { d, vertical, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }

  // Kiểu "dải ngân hà": mỗi đường nối có thêm 3 lớp chấm tròn (to / vừa / li ti) chạy chồng nhau.
  // Tạo lớp khi bật, gỡ lớp khi quay về nét đứt.
  _syncLayers(e, galaxy) {
    if (galaxy && !e.layers) {
      e.layers = [0, 1, 2].map(() => document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      let prev = e.p;
      for (const l of e.layers) { prev.after(l); prev = l; }
    } else if (!galaxy && e.layers) {
      e.layers.forEach((l) => l.remove());
      e.layers = null;
    }
  }

  // Gộp mọi yêu cầu vẽ trong cùng một frame
  _scheduleDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._drawLinks(); });
  }

  // Đo toàn bộ node MỘT lượt (pha đọc) rồi mới ghi thuộc tính (pha ghi, chỉ khi giá trị đổi)
  // → tránh ép layout lặp lại giữa các đường nối.
  _drawLinks() {
    const svg = this.renderRoot.querySelector('svg.links');
    const tree = this.renderRoot.querySelector('.tree');
    const t = this._tree;
    if (!svg || !tree || !t) return;
    if (this._svgEl !== svg) { this._svgEl = svg; this._paths.clear(); } // svg bị Lit dựng lại → bỏ path cũ

    // 1) Danh sách đường cần vẽ
    const want = [];
    const link = (id, from, to, bps, cls = '', status = 'ok', label = null, side = false) =>
      want.push({ id, from, to, bps, cls, status, label, side });
    if (t.isp && t.pf) {
      link('wan', 'isp', 'pf', (t.wan.down || 0) + (t.wan.up || 0), '', t.wan.status, [t.wan.down, t.wan.up]);
    }
    if (t.pf) {
      link('lan', 'pf', 'ctrl', (t.lan.down || 0) + (t.lan.up || 0), '', t.lan.status, [t.lan.down, t.lan.up]);
    }
    // Đường nối switch cha → switch con, có nhãn ↓ ↑ (tắt bằng link_labels: false)
    for (const a of t.aps) {
      if (!a.parentId) continue;
      const lab = this._config.link_labels !== false && a.down != null ? [a.down, a.up] : null;
      link(`${a.parentId}>${a.id}`, a.parentId, a.id, (a.down || 0) + (a.up || 0), '', a.linkStatus, lab);
    }
    if (this._coreOpen && t.ctrl.apId) {
      for (const k of t.ctrl.kids) link(`${t.ctrl.id}>${k.id}`, t.ctrl.id, k.id, k.down + k.up, 'cc', 'ok', null, true);
    }
    this._curCols.forEach((a, i) => {
      // Cổng xếp thành cột dọc → đường nối đi vào cạnh bên của từng cổng, không đâm thẳng từ trên xuống.
      // Cột đã ghim có thể nằm bất cứ đâu nên luôn dùng đường vào cạnh bên, kể cả chế độ dọc.
      const side = !this._vertical() || !!this._pin(a.apId);
      for (const k of a.kids) link(`${a.id}>${k.id}`, a.id, k.id, k.down + k.up, `c${i}`, 'ok', null, side);
    });

    // 2) PHA ĐỌC: toạ độ quy về hệ chưa zoom
    const NS = 'http://www.w3.org/2000/svg';
    const vert = this._vertical();
    const galaxy = this._config.flow_style === 'galaxy';
    const thr = this._config.active_threshold_bps;
    const z = this._zoom, base = tree.getBoundingClientRect();
    const rects = new Map();
    for (const el of this.renderRoot.querySelectorAll('[data-nid]')) {
      const r = el.getBoundingClientRect();
      rects.set(el.dataset.nid, {
        l: (r.left - base.left) / z, r: (r.right - base.left) / z,
        t: (r.top - base.top) / z, b: (r.bottom - base.top) / z,
      });
    }

    // 3) PHA GHI
    const put = (el, k, v) => {
      const c = el._c || (el._c = {});
      if (c[k] !== v) { c[k] = v; el.setAttribute(k, v); }
    };
    const putText = (el, v) => { if (el._t !== v) { el._t = v; el.textContent = v; } };
    const keep = new Set();
    for (const w of want) {
      const A = rects.get(w.from), B = rects.get(w.to);
      if (!A || !B) continue;
      keep.add(w.id);
      let e = this._paths.get(w.id);
      if (!e) {
        const p = document.createElementNS(NS, 'path');
        svg.appendChild(p);
        let txt = null;
        if (w.label) {
          txt = document.createElementNS(NS, 'text');
          txt.appendChild(document.createElementNS(NS, 'tspan'));
          txt.appendChild(document.createElementNS(NS, 'tspan'));
          svg.appendChild(txt);
        }
        e = { p, txt };
        this._paths.set(w.id, e);
      }
      const g = this._curve(A, B, vert, w.side);
      const bad = w.status === 'bad', active = !bad && w.bps > thr;
      const vars = flowVars(w.bps);
      this._syncLayers(e, galaxy);
      put(e.p, 'd', g.d);
      put(e.p, 'class', `${w.cls} ${bad ? 'bad' : active ? (galaxy ? 'gx' : '') : 'idle'}`);
      put(e.p, 'style', vars);
      if (e.layers) {
        e.layers.forEach((l, i) => {
          put(l, 'd', g.d);
          put(l, 'class', `${w.cls} gl gl${i}${active ? '' : ' off'}`);
          put(l, 'style', vars);
        });
      }
      if (e.txt && w.label) {
        const [s1, s2] = e.txt.childNodes;
        putText(s1, `↓ ${fmtRate(w.label[0])}`);
        putText(s2, `↑ ${fmtRate(w.label[1])}`);
        const x = g.vertical ? g.mx + 8 : g.mx;
        const y = g.vertical ? g.my - 4 : g.my - 16;
        put(e.txt, 'text-anchor', g.vertical ? 'start' : 'middle');
        put(s1, 'x', x); put(s1, 'y', y);
        put(s2, 'x', x); put(s2, 'y', y + 11);
      }
    }
    for (const [id, e] of this._paths) {
      if (keep.has(id)) continue;
      e.p.remove();
      if (e.layers) e.layers.forEach((l) => l.remove());
      if (e.txt) e.txt.remove();
      this._paths.delete(id);
    }
  }

  // ── Render ──
  _node(n) {
    const subs = (n.subs || []).filter(Boolean);
    const si = n.apId ? this._curCols.findIndex((a) => a.apId === n.apId) : -1;
    // Có logo thì dùng ảnh; ảnh lỗi (sai đường dẫn) quay về icon mdi (ghi nhớ để Lit render lại)
    const logoOk = n.logo && !this._badLogos.has(n.logo);
    const logoFail = () => { this._badLogos.add(n.logo); this.requestUpdate(); };
    const coreOn = n.apId === 'core' && this._coreOpen;
    const movable = n.hub || n.depth > 0;   // hub và switch kéo được; node cổng thiết bị thì không
    return html`<div class="node ${n.status} ${si >= 0 ? `sel sel${si}` : coreOn ? 'sel selcore' : ''} ${n.hub ? 'hubnode' : ''} ${this._lvClass(n)}"
        data-nid=${n.id}
        style=${n.hub ? this._hubStyle(n.id) : movable ? this._swStyle(n.id) : ''}
        @click=${() => this._tap(n)}
        @pointerdown=${movable ? (e) => this._dragStart(e, n) : null}>
      <div class="ico">${logoOk
        ? html`<img class="logo" src=${n.logo} alt="" draggable="false" @error=${logoFail} />`
        : html`<ha-icon .icon=${n.icon}></ha-icon>`}</div>
      <span class="stdot"></span>
      <div class="txt">
        <div class="name" title=${n.tip ? `${n.label}\n${n.tip}` : n.label}>${n.label}</div>
        ${subs.map((s) => html`<div class="sub">${s}</div>`)}
        ${n.down != null
          ? html`<div class="rate"><span class="d">↓ ${fmtRate(n.down)}</span> <span class="u">↑ ${fmtRate(n.up)}</span></div>`
          : ''}
      </div>
      ${n.apId
        ? html`<ha-icon class="tg" .icon=${si >= 0 || coreOn ? 'mdi:minus-circle-outline' : 'mdi:plus-circle-outline'}></ha-icon>`
        : ''}
    </div>`;
  }

  _ap(a) {
    return html`<div class="kid">${this._node(a)}</div>`;
  }

  // Mỗi cấp switch (con của switch lõi, cháu…) là một cột (chế độ ngang) hoặc một hàng (chế độ dọc)
  _levels(t) {
    const out = [];
    for (const a of t.aps) (out[a.depth - 1] = out[a.depth - 1] || []).push(a);
    return out.filter(Boolean);
  }

  // ── Tìm kiếm / toàn màn hình ──
  _toggleSearch() {
    this._searchOpen = !this._searchOpen;
    if (this._searchOpen) {
      this.updateComplete.then(() => {
        const i = this.renderRoot.querySelector('.sq');
        if (i) i.focus();
      });
    } else if (this._q) { this._q = ''; this._tick(); }
  }

  // Gõ tìm kiếm: lọc client trong mọi AP, tự mở các AP có kết quả (tối đa client_columns AP)
  _onSearch(e) {
    this._q = e.target.value;
    this._tick();
    if (this._q.trim() && this._tree) {
      this._selected = this._tree.aps.filter((a) => a.apId && a.kids.length)
        .slice(0, this._config.client_columns).map((a) => a.apId);
    }
  }

  // Có nút chuyển → ưu tiên lựa chọn đã lưu của người dùng; không có nút → luôn theo config
  _resolveStyle() {
    let saved = null;
    if (this._config.style_toggle) {
      try { saved = localStorage.getItem(STYLE_KEY); } catch (e) { /* bỏ qua */ }
    }
    return STYLES.includes(saved) ? saved : this._config.style;
  }

  _toggleStyle() {
    this._style = this._style === 'neon' ? 'glass' : 'neon';
    try { localStorage.setItem(STYLE_KEY, this._style); } catch (e) { /* bỏ qua */ }
  }

  _toggleFs() {
    const el = this.renderRoot.querySelector('ha-card');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el && el.requestFullscreen) el.requestFullscreen();
  }

  // Đồ thị nhỏ: chuẩn hoá theo giá trị lớn nhất trong lịch sử
  _spark(arr, cls) {
    const w = 64, h = 22;
    if (arr.length < 2) {
      return html`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}"><line x1="0" y1=${h - 2} x2=${w} y2=${h - 2}></line></svg>`;
    }
    const max = Math.max(...arr, 1);
    const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
    return html`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points=${pts}></polyline></svg>`;
  }

  _head() {
    const c = this._config;
    const canEdit = c.layout_edit !== false;
    const pct = Math.round(this._zoom * 100);
    const T = this._tree && this._tree.totals;
    return html`<div class="head">
      <div class="brand">
        <div class="logo-c"><ha-icon icon="mdi:lan"></ha-icon></div>
        <div><div class="title">${c.title || ''}</div>${c.subtitle ? html`<div class="subtitle">${c.subtitle}</div>` : ''}</div>
      </div>
      ${T ? html`<div class="stats">
        <div class="tile"><div class="ti on"></div><div>
          <div class="tl">Cổng đang up</div><div class="tv">${T.online}<span class="tm"> / ${T.known}</span></div></div></div>
        <div class="tile"><div class="ti dn"><ha-icon icon="mdi:arrow-down"></ha-icon></div><div>
          <div class="tl">Tổng tải xuống</div><div class="tv">${fmtRate(T.down)}</div></div>${this._spark(this._hist.down, 'dn')}</div>
        <div class="tile"><div class="ti up"><ha-icon icon="mdi:arrow-up"></ha-icon></div><div>
          <div class="tl">Tổng tải lên</div><div class="tv">${fmtRate(T.up)}</div></div>${this._spark(this._hist.up, 'up')}</div>
        ${T.speed ? html`<div class="tile speed" title=${T.speed.at ? `Đo lúc ${new Date(T.speed.at).toLocaleString('vi-VN')}` : 'Kết quả Speedtest gần nhất'}>
          <div class="ti sp"><ha-icon icon="mdi:speedometer"></ha-icon></div><div>
          <div class="tl">Speedtest${T.speed.ping != null ? ` · ${Math.round(T.speed.ping)} ms` : ''}</div>
          <div class="tv"><span class="sd">↓ ${fmtRate(T.speed.down)}</span> <span class="su">↑ ${fmtRate(T.speed.up)}</span></div></div></div>` : ''}
      </div>` : ''}
      <div class="right">
        <div class="tools">
          ${c.style_toggle ? html`<div class="zb" role="button" title=${this._style === 'neon' ? 'Đổi sang giao diện Glass (theo theme HA)' : 'Đổi sang giao diện Neon (tối)'} @click=${() => this._toggleStyle()}><ha-icon icon="mdi:theme-light-dark"></ha-icon></div>` : ''}
          ${this._searchOpen ? html`<input class="sq" type="search" placeholder="Tìm tên, IP hoặc cổng…" .value=${this._q} @input=${(e) => this._onSearch(e)} />` : ''}
          <div class="zb ${this._searchOpen ? 'on' : ''}" role="button" title="Tìm thiết bị" @click=${() => this._toggleSearch()}><ha-icon icon="mdi:magnify"></ha-icon></div>
          <div class="zb" role="button" title="Toàn màn hình" @click=${() => this._toggleFs()}><ha-icon icon="mdi:fullscreen"></ha-icon></div>
          ${canEdit && this._edit ? html`<div class="zb" role="button" title="Đặt lại vị trí mặc định" @click=${() => this._resetLayout()}><ha-icon icon="mdi:restore"></ha-icon></div>` : ''}
          <div class="zb ${this._autoOn ? 'on' : ''}" role="button" title=${this._autoOn ? 'Tắt tự động xoay AP' : 'Bật tự động xoay AP'} @click=${() => this._toggleAuto()}><ha-icon icon="mdi:autorenew"></ha-icon></div>
          ${canEdit ? html`<div class="zb ${this._edit ? 'on' : ''}" role="button" title="Sắp xếp ISP / pfSense / các switch (kéo thả)" @click=${() => this._toggleEdit()}><ha-icon icon=${this._edit ? 'mdi:check' : 'mdi:cursor-move'}></ha-icon></div>` : ''}
          ${c.show_zoom ? html`
            <div class="zb" role="button" title="Thu nhỏ" @click=${() => this._setZoom(this._zoom - 0.1)}><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></div>
            <span class="zl" title="Về 100%" @click=${() => this._setZoom(1)}>${pct}%</span>
            <div class="zb" role="button" title="Phóng to" @click=${() => this._setZoom(this._zoom + 0.1)}><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></div>
            <div class="zb" role="button" title="Vừa khung" @click=${() => this._fit()}><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></div>` : ''}
        </div>
      </div>
    </div>`;
  }

  render() {
    if (!this._config) return html``;
    const c = this._config;
    const v = this._vertical();
    const t = this._tree;
    this._curCols = this._cols();
    let body;
    if (!t) body = html`<div class="msg">${this._error || 'Đang tải dữ liệu SNMP…'}</div>`;
    else {
      this._geom = this._hubGeom(t);
      const hubSize = v ? `height:${this._geom.h}px` : `width:${this._geom.w}px`;
      body = html`<div class="scroll ${c.hide_scrollbar ? 'nobar' : ''}" @wheel=${(e) => this._wheel(e)}>
        <div class="zwrap">
          <div class="tree ${v ? 'v' : 'h'} ${this._edit ? 'editing' : ''}">
            ${this._edit
              ? html`<div class="canvas"><div class="hint">Kéo thả các node (ISP, pfSense, switch) và cột thiết bị (nắm tiêu đề cột để ghim vị trí, bấm đúp để bỏ ghim), bấm ✓ để lưu và thu gọn</div></div>`
              : ''}
            <svg class="links"></svg>
            <div class="apzone">
              <div class="hub" style=${hubSize}>
                ${t.isp ? this._node(t.isp) : ''}
                ${t.pf ? this._node(t.pf) : ''}
                ${this._node(t.ctrl)}
                ${this._coreOpen && t.ctrl.apId && !this._pin('core')
                  ? this._colBlock(t.ctrl, 'core', 'core abs', this._coreColStyle()) : ''}
              </div>
              ${this._levels(t).map((lv) => html`<div class="kids">${lv.map((a) => this._ap(a))}</div>`)}
            </div>
            ${this._curCols.some((a) => !this._pin(a.apId))
              ? html`<div class="cols ${this._autoOn ? (this._fadeSeq % 2 ? 'fb' : 'fa') : ''}">
                  ${this._curCols.map((a, i) => this._pin(a.apId) ? '' : this._colBlock(a, a.apId, `c${i}`, ''))}
                </div>`
              : ''}
            ${this._coreOpen && t.ctrl.apId && this._pin('core')
              ? this._colBlock(t.ctrl, 'core', 'core abs pinned', this._pinStyle(this._pin('core'))) : ''}
            ${this._curCols.map((a, i) => this._pin(a.apId)
              ? this._colBlock(a, a.apId, `c${i} abs pinned`, this._pinStyle(this._pin(a.apId))) : '')}
          </div>
        </div>
        ${t.found ? '' : html`<div class="msg">Chưa thấy switch nào từ integration SNMP Switch Manager. Kiểm tra integration và tên switch trong cấu hình.</div>`}
      </div>`;
    }
    const fixed = this._fixedHeight();
    const neon = this._style === 'neon';   // neon có nền riêng → bỏ qua transparent / blur
    const cls = `s-${this._style} ${!neon && c.transparent ? 'transp' : ''} ${!neon && c.blur > 0 ? 'blur' : ''} ${c.node_blur > 0 ? 'nblur' : ''} ${fixed ? 'fixed' : ''}`;
    const sty = `--utwc-blur:${c.blur}px;--utwc-nblur:${c.node_blur}px;--utwc-nop:${c.node_opacity}${fixed ? `;height:${fixed}px` : ''}`;
    return html`<ha-card class=${cls} style=${sty}>${this._head()}${body}</ha-card>`;
  }

  static get styles() {
    return css`
      :host { display: block; height: 100%; }
      ha-card { padding: 12px 8px 12px 12px; overflow: hidden; box-sizing: border-box; height: 100%; display: flex; flex-direction: column; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 10px; }
      .title { font-size: var(--ha-card-header-font-size, 20px); color: var(--primary-text-color); }
      .zoom { display: flex; align-items: center; gap: 2px; color: var(--secondary-text-color); }
      .zb { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; }
      .zb:hover { background: var(--secondary-background-color); }
      .zb.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
      .zb ha-icon { --mdc-icon-size: 20px; }
      .zl { min-width: 38px; text-align: center; font-size: 12px; cursor: pointer; }
      .scroll { overflow-x: auto; padding-bottom: 4px; flex: 1 1 auto; }
      /* Ẩn thanh cuộn (vẫn cuộn được bằng con lăn / cảm ứng / touchpad) */
      .scroll.nobar { scrollbar-width: none; -ms-overflow-style: none; }
      .scroll.nobar::-webkit-scrollbar { display: none; }

      /* Chiều cao cố định: header đứng yên, chỉ vùng sơ đồ cuộn (không đẩy các card bên dưới) */
      ha-card.fixed .scroll { overflow: auto; min-height: 0; }
      .zwrap { position: relative; }
      .msg { padding: 12px 4px; color: var(--secondary-text-color); font-size: 13px; }

      /* Màu theo cột: đường nối, tiêu đề cột và viền AP đang chọn dùng cùng màu */
      .c0, .sel0 { --col: var(--primary-color); }
      .c1, .sel1 { --col: var(--utwc-c1-color, #43a047); }
      .c2, .sel2 { --col: var(--utwc-warn); }

      /* Bố cục: [hub 3 node tự do + cột AP cố định] + [các cột client, mỗi cột căn giữa] */
      .tree { position: relative; display: flex; align-items: flex-start; width: max-content; transform-origin: 0 0; isolation: isolate; }
      .apzone { display: flex; flex: none; }
      .hub { position: relative; flex: none; align-self: stretch; min-height: 90px; }
      /* Vùng sắp xếp: phủ toàn bộ .tree (tree được giãn bằng khung nhìn trong _applyZoom) */
      .canvas {
        position: absolute; inset: 0; z-index: 0; pointer-events: none; border-radius: 12px;
        outline: 1px dashed var(--divider-color); outline-offset: -1px;
        background-image: radial-gradient(var(--divider-color) 1px, transparent 1px);
        background-size: 16px 16px;
      }
      .canvas .hint { position: absolute; left: 10px; bottom: 6px; font-size: 11px; color: var(--secondary-text-color); }
      .kids { display: flex; flex-direction: column; margin-left: 110px; }
      .kid { padding: 3px 0; }
      .cols { align-self: stretch; display: flex; align-items: center; }
      .ccol { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6px; margin-left: 96px; padding-right: 4px; }
      .ccol .node { width: 230px; max-width: none; padding: 4px 10px; }
      .chead { font-size: 12px; font-weight: 600; color: var(--col, var(--primary-text-color)); padding: 0 2px 2px; }
      .ccol .more { padding-left: 4px; }

      svg.links { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 0; }
      svg.links path {
        fill: none; stroke: var(--col, var(--primary-color)); stroke-width: var(--w, 2px); opacity: var(--o, 0.5);
        stroke-dasharray: 6 6; animation: dash var(--d, 0s) linear infinite;
      }
      svg.links path.idle { stroke: var(--divider-color); stroke-dasharray: none; animation: none; opacity: 1; }
      svg.links path.bad { stroke: var(--utwc-bad); stroke-dasharray: 4 6; animation: none; opacity: 0.85; }
      svg.links text {
        font-size: 10px; fill: var(--secondary-text-color);
        paint-order: stroke; stroke: var(--utwc-halo, var(--ha-card-background, var(--card-background-color, #fff))); stroke-width: 3px; stroke-linejoin: round;
      }
      @keyframes dash { to { stroke-dashoffset: -12; } }
      @media (prefers-reduced-motion: reduce) { svg.links path { animation: none; } }

      .node {
        position: relative; z-index: 1;
        display: flex; align-items: center; gap: 8px; box-sizing: border-box;
        min-width: 120px; max-width: 230px; padding: 6px 10px; cursor: pointer;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border-radius: var(--ha-card-border-radius, 12px);
        border-left: 4px solid var(--disabled-text-color);
      }
      .node.hubnode { position: absolute; max-width: none; transform: translateY(-50%); }
      .tree.editing .hubnode, .tree.editing .kid > .node {
        cursor: grab; touch-action: none; user-select: none; outline: 1px dashed var(--primary-color);
      }
      .tree.editing .node.dragging { cursor: grabbing; z-index: 3; }
      .tree.editing .chead { cursor: grab; touch-action: none; user-select: none; outline: 1px dashed var(--primary-color); border-radius: 6px; }
      .tree.editing .ccol.dragging { z-index: 3; }
      .tree.editing .ccol.dragging .chead { cursor: grabbing; }
      .node.ok { border-left-color: var(--utwc-ok); }
      .node.bad { border-left-color: var(--utwc-bad); }
      .node.sel { outline: 2px solid var(--col, var(--primary-color)); outline-offset: -2px; }
      .node ha-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); flex: none; }
      .node .tg { --mdc-icon-size: 18px; margin-left: auto; }
      .node .logo { width: 30px; height: 30px; object-fit: contain; flex: none; }
      .kids > .kid > .node { width: 210px; max-width: none; }
      .txt { min-width: 0; }
      .name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
      .rate { font-size: 11px; white-space: nowrap; }
      .d { color: var(--info-color, var(--primary-color)); }
      .u { color: var(--accent-color, var(--primary-color)); }

      /* ═══ Giao diện hiện đại: kính mờ + node nổi 3D ═══ */
      ha-card {
        --utwc-glass: linear-gradient(145deg,
          color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent),
          color-mix(in srgb, var(--card-background-color, #fff) 50%, transparent));
        --utwc-edge: color-mix(in srgb, var(--primary-text-color, #000) 9%, transparent);
        --utwc-lift: 0 1px 0 color-mix(in srgb, #fff 50%, transparent) inset,
          0 10px 24px -10px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.07);
        --utwc-ok: var(--success-color, #43a047);
        --utwc-bad: var(--error-color, #db4437);
        --utwc-warn: var(--warning-color, #ffa600);
        --utwc-down: var(--info-color, #039be5);
        --utwc-up: var(--utwc-up-color, #8e5be8);
        padding: 14px;
      }
      ha-card.s-glass { border: 1px solid var(--utwc-edge); }
      ha-card:fullscreen { height: 100% !important; border-radius: 0; padding: 20px; background: var(--primary-background-color) !important; }

      .head {
        display: flex; flex-wrap: nowrap; align-items: center; gap: 8px 14px; padding: 8px 12px; margin: 0 0 12px;
        border-radius: 16px; border: 1px solid var(--utwc-edge); background: var(--utwc-glass); box-shadow: var(--utwc-lift);
      }
      .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .logo-c { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; flex: none;
        color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
      .logo-c ha-icon { --mdc-icon-size: 22px; }
      .title { font-size: 17px; font-weight: 700; line-height: 1.15; white-space: nowrap; }
      .subtitle { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
      .stats { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; justify-content: center; min-width: 0; }
      .tile { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 12px; white-space: nowrap;
        border: 1px solid var(--utwc-edge); background: var(--utwc-glass); box-shadow: var(--utwc-lift); }
      .ti { position: relative; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; flex: none; color: #fff; }
      .ti ha-icon { --mdc-icon-size: 17px; }
      .ti.on { background: var(--utwc-ok); }
      .ti.on::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #fff; opacity: 0.9; }
      .ti.dn { background: var(--utwc-down); }
      .ti.up { background: var(--utwc-up); }
      .ti.sp { background: var(--utwc-warn); }
      .tile.speed .tv { font-size: 14px; }
      .tv .sd { color: var(--utwc-down); }
      .tv .su { color: var(--utwc-up); }
      .tl { font-size: 10px; line-height: 1.2; color: var(--secondary-text-color); }
      .tv { font-size: 15px; font-weight: 600; line-height: 1.2; }
      .tm { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); }
      .spark { width: 44px; height: 18px; fill: none; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
      .spark.dn { stroke: var(--utwc-down); }
      .spark.up { stroke: var(--utwc-up); }
      .right { display: flex; align-items: center; margin-left: auto; }
      .tools { display: flex; align-items: center; gap: 0; color: var(--secondary-text-color); }
      .tools .zb { width: 28px; height: 28px; }
      .tools .zb ha-icon { --mdc-icon-size: 18px; }
      .tools .zl { min-width: 34px; }
      .sq { height: 28px; width: 140px; box-sizing: border-box; margin-right: 4px; padding: 0 12px; border-radius: 14px;
        border: 1px solid var(--utwc-edge); background: var(--input-fill-color, rgba(0, 0, 0, 0.04)); color: var(--primary-text-color); font: inherit; font-size: 12px; }

      /* Card hẹp thì tự ẩn bớt chi tiết để header luôn nằm gọn một hàng */
      ha-card { container-type: inline-size; }
      @container (max-width: 980px) { .spark { display: none; } .tile.speed .tl { display: none; } }
      @container (max-width: 780px) { .subtitle, .tl { display: none; } .tile { padding: 5px 8px; } .tv { font-size: 14px; } }
      @container (max-width: 560px) { .head { flex-wrap: wrap; } }

      .node {
        gap: 10px; padding: 8px 12px; border-radius: 14px;
        border: 1px solid var(--utwc-edge); border-left: 4px solid var(--disabled-text-color);
        /* Lớp nền đặc phía dưới lớp kính (độ đặc chỉnh bằng node_opacity) để đường flow không lộ xuyên qua chữ */
        background: var(--utwc-glass),
          color-mix(in srgb, var(--card-background-color, #1c1c1c) calc(var(--utwc-nop, 80) * 1%), transparent);
        box-shadow: var(--utwc-lift);
        transition: box-shadow 0.2s, filter 0.2s;
      }
      .node:hover { filter: brightness(1.04); box-shadow: 0 1px 0 color-mix(in srgb, #fff 55%, transparent) inset, 0 14px 28px -10px rgba(0, 0, 0, 0.35), 0 3px 8px rgba(0, 0, 0, 0.1); }
      ha-card.nblur .node { backdrop-filter: blur(var(--utwc-nblur, 4px)); -webkit-backdrop-filter: blur(var(--utwc-nblur, 4px)); }
      .ccol .node { padding: 6px 12px; }
      .ico { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%;
        background: color-mix(in srgb, var(--primary-text-color, #000) 7%, transparent);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 0 color-mix(in srgb, #fff 40%, transparent); }
      .ccol .ico { width: 32px; height: 32px; }
      .ico .logo { width: 24px; height: 24px; }
      .stdot { position: absolute; top: 9px; right: 11px; width: 8px; height: 8px; border-radius: 50%; background: var(--disabled-text-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent); }
      .node.ok .stdot { background: var(--utwc-ok); }
      .node.bad .stdot { background: var(--utwc-bad); }
      .node.sel {
        outline: none;
        background: linear-gradient(145deg,
          color-mix(in srgb, var(--col, var(--primary-color)) 16%, var(--card-background-color, #fff)),
          color-mix(in srgb, var(--col, var(--primary-color)) 6%, transparent));
        border-color: color-mix(in srgb, var(--col, var(--primary-color)) 55%, transparent);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--col, var(--primary-color)) 55%, transparent),
          0 10px 22px -8px color-mix(in srgb, var(--col, var(--primary-color)) 45%, transparent);
      }
      .chead { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; padding: 0 2px 4px; }
      .chead ha-icon { --mdc-icon-size: 18px; color: var(--col, var(--secondary-text-color)); }

      /* ═══ Giao diện neon (palette lấy từ server-monitor-card) ═══
         Không viết lại từng rule: chỉ ghi đè các biến theme ngay trên ha-card,
         mọi thứ bên trong (header, tile, node, nhãn flow…) tự đổi theo. */
      ha-card.s-neon {
        --primary-text-color: #e6edf7;
        --secondary-text-color: #94a3b8;
        --disabled-text-color: color-mix(in srgb, #e6edf7 35%, transparent);
        --divider-color: rgba(120, 160, 255, 0.15);
        --primary-color: #22d3ee;
        --text-primary-color: #06101f;
        --card-background-color: #0b1226;
        --secondary-background-color: rgba(120, 160, 255, 0.1);
        --input-fill-color: rgba(120, 160, 255, 0.08);
        --utwc-ok: #34d399;
        --utwc-bad: #f87171;
        --utwc-warn: #fbbf24;
        --utwc-down: #22d3ee;
        --utwc-up: #a78bfa;
        --utwc-halo: #0b1226;
        --utwc-glass: linear-gradient(145deg, rgba(120, 160, 255, 0.12), rgba(120, 160, 255, 0.04));
        --utwc-edge: rgba(120, 160, 255, 0.15);
        --utwc-lift: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 10px 24px -10px rgba(0, 0, 0, 0.6);
        background: radial-gradient(900px 420px at 0% -10%, #16254a 0%, #0b1226 55%, #070b18 100%);
        border: 1px solid var(--utwc-edge);
        border-radius: 20px;
        color: var(--primary-text-color);
        color-scheme: dark;
      }
      ha-card.s-neon:fullscreen { background: #070b18 !important; }
      ha-card.s-neon .node:hover { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.1) inset, 0 14px 28px -10px rgba(0, 0, 0, 0.75); }
      ha-card.s-neon .ico { box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.06); }

      /* Nền trong suốt + blur nhẹ (nhãn tốc độ lấy viền theo nền view để vẫn đọc được) */
      ha-card.transp { background: transparent; --utwc-halo: var(--primary-background-color, #fff); }
      ha-card.blur { backdrop-filter: blur(var(--utwc-blur, 6px)); -webkit-backdrop-filter: blur(var(--utwc-blur, 6px)); }

      /* Auto xoay AP: đổi tên animation mỗi lần đổi AP để hiệu ứng mờ dần chạy lại */
      .cols.fa { animation: cfade-a 0.5s ease; }
      .cols.fb { animation: cfade-b 0.5s ease; }
      @keyframes cfade-a { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cfade-b { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .cols.fa, .cols.fb { animation: none; } }

      /* Glow cảnh báo lưu lượng: vàng = lớn, đỏ = rất lớn (vẽ bằng lớp ::after để nhấp nháy mà không vẽ lại cả node) */
      .node::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; }
      .node.lv1::after {
        opacity: 1; animation: glow 2.4s ease-in-out infinite;
        box-shadow: 0 0 0 1px var(--utwc-warn), 0 0 12px 3px color-mix(in srgb, var(--utwc-warn) 70%, transparent);
      }
      .node.lv2::after {
        opacity: 1; animation: glow 1s ease-in-out infinite;
        box-shadow: 0 0 0 1px var(--utwc-bad), 0 0 16px 5px color-mix(in srgb, var(--utwc-bad) 80%, transparent);
      }
      @keyframes glow { 50% { opacity: 0.4; } }
      @media (prefers-reduced-motion: reduce) { .node.lv1::after, .node.lv2::after { animation: none; } }

      /* Đường flow kiểu dải ngân hà: đường gốc chỉ còn sợi mảnh mờ, 3 lớp chấm tròn chạy trên nó.
         Mỗi lớp có kích thước, khoảng cách (không đều) và tốc độ khác nhau, lấp lánh lệch pha. */
      svg.links path.gx { stroke-dasharray: none; animation: none; stroke-width: 1px; opacity: 0.18; }
      svg.links path.gl {
        fill: none; stroke: var(--col, var(--primary-color)); stroke-linecap: round;
        stroke-dashoffset: 0;
      }
      svg.links path.gl.off { display: none; }
      svg.links path.gl0 {
        stroke-width: calc(var(--w, 2px) * 0.9 + 2px); stroke-dasharray: 0.1 61 0.1 38 0.1 83;
        animation: gx0 calc(var(--d, 2.6s) * 6.5) linear infinite, tw 3.1s ease-in-out infinite alternate;
      }
      svg.links path.gl1 {
        stroke-width: calc(var(--w, 2px) * 0.5 + 1.2px); stroke-dasharray: 0.1 29 0.1 17 0.1 54;
        animation: gx1 calc(var(--d, 2.6s) * 2.5) linear infinite, tw 2.3s ease-in-out -0.9s infinite alternate;
      }
      svg.links path.gl2 {
        stroke-width: calc(var(--w, 2px) * 0.25 + 0.6px); stroke-dasharray: 0.1 14 0.1 9 0.1 8 0.1 22;
        animation: gx2 calc(var(--d, 2.6s) * 1.1) linear infinite, tw 1.7s ease-in-out -1.4s infinite alternate;
      }
      @keyframes gx0 { to { stroke-dashoffset: -182.3; } }
      @keyframes gx1 { to { stroke-dashoffset: -100.3; } }
      @keyframes gx2 { to { stroke-dashoffset: -53.4; } }
      @keyframes tw { from { opacity: calc(var(--o, 0.5) * 0.35); } to { opacity: var(--o, 0.5); } }
      @media (prefers-reduced-motion: reduce) { svg.links path.gl { animation: none; } }

      /* Card ngoài màn hình (IntersectionObserver đặt thuộc tính paused) → dừng animation */
      :host([paused]) svg.links path,
      :host([paused]) .node::after { animation-play-state: paused !important; }

      /* Chế độ ngang: .cnodes trong suốt để cột client giữ nguyên bố cục cũ */
      .tree.h .cnodes { display: contents; }

      /* Chế độ dọc: hub → hàng AP → hàng client; mỗi cấp đúng 1 hàng (không xuống dòng)
         để đường nối từ trên xuống không chồng chéo */
      .tree.v { flex-direction: column; align-items: stretch; }
      .tree.v .apzone { flex-direction: column; }
      .tree.v .hub { width: 100%; min-height: 0; align-self: stretch; }
      .tree.v .node.hubnode { transform: translateX(-50%); }
      .tree.v .kids { flex-direction: row; flex-wrap: nowrap; justify-content: space-evenly; gap: 12px; margin: 64px 0 0; }
      .tree.v .kid { padding: 0; flex: none; }
      .tree.v .cols { flex-direction: row; align-items: flex-start; justify-content: space-evenly; gap: 40px; margin-top: 64px; }
      .tree.v .ccol { flex-direction: column; align-items: center; gap: 6px; margin-left: 0; padding: 0; }
      .tree.v .cnodes { display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 10px; }
      .tree.v .ccol .node { width: 210px; flex: none; }
      .tree.v .chead { padding: 0; }

      /* Cột của switch lõi: nằm ngoài luồng, độc lập với cột của các switch khác; luôn xếp dọc, màu riêng */
      .cc, .selcore { --col: var(--utwc-ok); }
      .tree .ccol.abs { position: absolute; z-index: 1; margin: 0; padding: 0; align-items: stretch; }
      .tree .ccol.abs .cnodes { display: flex; flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 6px; }
      .tree.v .ccol.abs .node { width: 230px; }
      .chead .pinned { --mdc-icon-size: 12px; color: var(--secondary-text-color); vertical-align: -1px; }
    `;
  }
}

// ───────────────────────── Visual editor ─────────────────────────
// Dựng theo khuôn editor của sysdesk: các nhóm đóng/mở, slider, nút chọn, entity picker.
const EDITOR_TAG = `${CARD_TAG}-editor`;
const KEEP_EMPTY = ['isp', 'pfsense']; // node chỉ hiện khi có khai báo → giữ object rỗng khi đã bật

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// Gán giá trị theo đường dẫn "a.b.c" (không sửa object gốc); giá trị rỗng → xoá key, dọn object cha rỗng
const setPath = (obj, path, value) => {
  const root = clone(obj || {});
  const keys = path.split('.');
  const chain = [root];
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
    chain.push(cur);
  }
  const last = keys[keys.length - 1];
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (empty) delete cur[last]; else cur[last] = value;
  for (let i = keys.length - 2; i >= 0; i--) {
    const parent = chain[i], k = keys[i];
    const isKept = i === 0 && KEEP_EMPTY.includes(k);
    if (Object.keys(parent[k]).length === 0 && !isKept) delete parent[k]; else break;
  }
  return root;
};

const ON_OFF = [[true, 'Bật'], [false, 'Tắt']];

// Ô nhiều dòng "khoá = giá trị" ↔ object (dùng cho port_names)
const kvText = (o) => Object.entries(o && typeof o === 'object' ? o : {})
  .map(([k, v]) => `${k} = ${v && typeof v === 'object' ? [v.name, v.ip].filter(Boolean).join(' | ') : v}`).join('\n');
const parseKv = (s) => {
  const out = {};
  for (const line of String(s).split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
};

// Mô tả form: t = text | csv | range | bool | choice | entity | entities
const EDITOR_SECTIONS = [
  { id: 'general', title: '⚙️ Chung', fields: [
    { k: 'title', t: 'text', label: 'Tiêu đề card', ph: 'Mạng LAN' },
    { k: 'subtitle', t: 'text', label: 'Phụ đề dưới tiêu đề', ph: 'LAN Topology' },
    { k: 'orientation', t: 'choice', label: 'Hướng sơ đồ', def: 'horizontal',
      opts: [['horizontal', '↔ Ngang'], ['vertical', '↕ Dọc']],
      hint: 'Dọc: mỗi cấp switch là một hàng ngang, đường flow chạy từ trên xuống.' },
    { k: 'height', t: 'optrange', label: 'Chiều cao card', min: 200, max: 1200, step: 10, def: 480,
      fmt: (v) => `${v}px`,
      hint: 'Cố định: card luôn cao đúng số px này, sơ đồ cuộn bên trong nên không đẩy lệch các card khác. Nút "Vừa khung" sẽ thu nhỏ sơ đồ vừa cả chiều ngang lẫn chiều dọc.' },
    { k: 'client_columns', t: 'choice', num: true, label: 'Số switch mở cùng lúc', def: 2,
      opts: [[1, '1'], [2, '2'], [3, '3']],
      hint: 'Bấm vào switch để xem các cổng đang có thiết bị; mỗi switch đang mở có một cột (hoặc một nhóm) riêng. Switch lõi mở độc lập: không tính vào số này và chỉ đóng khi bạn bấm lại vào nó.' },
    { k: 'max_ports', t: 'range', label: 'Số cổng tối đa mỗi switch', min: 1, max: 52, step: 1, def: 24 },
    { k: 'sort_clients', t: 'choice', label: 'Sắp xếp cổng', def: 'port',
      opts: [['port', 'Theo số cổng'], ['name', 'Theo tên'], ['traffic', 'Theo lưu lượng']],
      hint: 'Luôn lấy các cổng nhiều lưu lượng nhất trước, rồi mới sắp theo số cổng / tên (ổn định) hoặc giữ thứ tự lưu lượng (nhảy liên tục).' },
    { k: 'hide_idle', t: 'bool', label: 'Ẩn cổng đang nhàn rỗi', def: false,
      hint: 'Ẩn cổng có tốc độ dưới 200 bps.' },
    { k: 'show_down_ports', t: 'bool', label: 'Hiện cả cổng không có link', def: false },
    { k: 'link_labels', t: 'bool', label: 'Hiện tốc độ ↓ ↑ trên đường nối giữa các switch', def: true },
    { k: 'swap_rx_tx', t: 'bool', label: 'Đảo chiều ↓ ↑', def: false,
      hint: 'Mặc định ↓ là dữ liệu đi từ switch lõi xuống thiết bị. Bật nếu thấy ngược.' },
    { k: 'layout_edit', t: 'bool', label: 'Cho phép kéo thả ISP / pfSense / các switch', def: true },
    { k: 'layout_id', t: 'text', label: 'Mã bố cục (layout_id)', ph: 'mac-dinh',
      hint: 'Chỉ cần khi có nhiều card trùng tiêu đề mà muốn lưu vị trí riêng cho từng card.' },
  ] },
  { id: 'look', title: '🎨 Giao diện', fields: [
    { k: 'style', t: 'choice', label: 'Giao diện', def: 'glass',
      opts: [['glass', '🪟 Glass (theo theme HA)'], ['neon', '🌌 Neon (tối)']],
      hint: 'Glass lấy màu từ theme HA nên tự đổi sáng/tối theo chế độ của HA. Neon có nền tối cố định và bỏ qua \"Nền trong suốt\" / \"Độ mờ nền\".' },
    { k: 'style_toggle', t: 'bool', label: 'Nút đổi giao diện ở header', def: true,
      hint: 'Lựa chọn của người dùng được nhớ trên trình duyệt và dùng chung cho mọi card topo (Wi-Fi và LAN). Tắt nút thì luôn dùng giao diện đã chọn ở trên.' },
    { k: 'transparent', t: 'bool', label: 'Nền card trong suốt (chỉ Glass)', def: true },
    { k: 'blur', t: 'range', label: 'Độ mờ nền (blur, chỉ Glass)', min: 0, max: 20, step: 1, def: 6, fmt: (v) => `${v}px`,
      hint: 'Chỉ thấy rõ khi phía sau card có ảnh hoặc màu nền. Đặt 0 để tắt.' },
    { k: 'node_blur', t: 'range', label: 'Độ mờ kính của node', min: 0, max: 12, step: 1, def: 0, fmt: (v) => `${v}px`,
      hint: 'Nền mờ trên từng node đẹp hơn nhưng tốn GPU; màn hình yếu hoặc nhiều client thì đặt 0.' },
    { k: 'node_opacity', t: 'range', label: 'Độ đặc của node', min: 0, max: 100, step: 5, def: 80, fmt: (v) => `${v}%`,
      hint: 'Tăng lên để đường nối không lộ xuyên qua chữ trong node. 0 = trong suốt như cũ.' },
    { k: 'active_threshold_bps', t: 'range', label: 'Ngưỡng chạy animation đường nối', min: 0, max: 20000, step: 100, def: 2000,
      fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} Kbps` : `${v} bps`),
      hint: 'Đường nối có lưu lượng dưới ngưỡng này đứng yên (nhẹ máy hơn). Đặt 0 để luôn chạy.' },
    { k: 'flow_style', t: 'choice', label: 'Kiểu đường flow', def: 'dash',
      opts: [['dash', '┈ Nét đứt'], ['galaxy', '✦ Dải ngân hà']],
      hint: 'Dải ngân hà: chấm tròn li ti to nhỏ khác nhau trôi dọc đường nối, nhanh và dày theo băng thông.' },
    { k: 'hide_scrollbar', t: 'bool', label: 'Ẩn thanh cuộn', def: true,
      hint: 'Vẫn cuộn được bằng con lăn chuột, cảm ứng hoặc touchpad (giữ Shift + con lăn để cuộn ngang).' },
    { k: 'show_zoom', t: 'bool', label: 'Hiện nút zoom trên card', def: true },
    { k: 'zoom', t: 'range', label: 'Mức zoom ban đầu', min: 0.3, max: 1.6, step: 0.05, def: 1,
      fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'wheel_zoom', t: 'choice', label: 'Cuộn chuột để zoom', def: 'ctrl',
      opts: [['ctrl', 'Giữ Ctrl'], ['always', 'Luôn bật']] },
  ] },
  { id: 'auto', title: '🔁 Tự động xoay AP', fields: [
    { k: 'auto.mode', t: 'choice', label: 'Cách xoay', def: 'single',
      opts: [['single', '1 AP mỗi lần'], ['multi', 'Nhiều AP một lần']],
      hint: 'Bật/tắt bằng nút ↻ trên đầu card (cạnh nút ✥). Trạng thái được nhớ theo từng người dùng.' },
    { k: 'auto.count', t: 'choice', num: true, label: 'Số AP mỗi lần (khi chọn "Nhiều AP một lần")', def: 2,
      opts: [[1, '1'], [2, '2'], [3, '3']],
      hint: 'Không vượt quá "Số AP mở cùng lúc" ở nhóm Chung.' },
    { k: 'auto.interval', t: 'range', label: 'Đổi sau mỗi', min: 2, max: 60, step: 1, def: 6, fmt: (v) => `${v} giây` },
    { k: 'auto.skip_empty', t: 'bool', label: 'Bỏ qua AP không có client', def: true },
    { k: 'auto.pause_on_tap', t: 'range', label: 'Tạm dừng khi bạn tự bấm chọn AP', min: 0, max: 120, step: 5, def: 20,
      fmt: (v) => (v === 0 ? 'Không dừng' : `${v} giây`),
      hint: 'Hết thời gian này auto tự chạy tiếp.' },
  ] },
  { id: 'alerts', title: '🔔 Cảnh báo lưu lượng', fields: [
    { k: 'alerts.enabled', t: 'bool', label: 'Glow vàng / đỏ khi lưu lượng lớn', def: true,
      hint: 'Node phát sáng khi tốc độ (tải xuống + tải lên) vượt cả mức sàn của tầng lẫn trung bình hôm qua nhân hệ số. Tốc độ hạ xuống là tắt ngay. Thiết bị chưa có lịch sử chỉ so với mức sàn.' },
    { k: 'alerts.factor_warn', t: 'range', label: 'Glow vàng: vượt trung bình hôm qua', min: 1, max: 10, step: 0.1, def: 2, fmt: (v) => `×${v}` },
    { k: 'alerts.factor_crit', t: 'range', label: 'Glow đỏ: vượt trung bình hôm qua', min: 1, max: 20, step: 0.1, def: 4, fmt: (v) => `×${v}`,
      hint: 'Mức sàn bên dưới giúp thiết bị nhỏ không báo ảo: chỉ sáng khi vượt cả sàn lẫn hệ số.' },
    { k: 'alerts.floors.infra.warn', t: 'range', label: 'Hạ tầng (ISP, pfSense, switch lõi): sàn vàng', min: 1, max: 500, step: 1, def: 20, fmt: (v) => `${v} Mbps` },
    { k: 'alerts.floors.infra.crit', t: 'range', label: 'Hạ tầng: sàn đỏ', min: 2, max: 1000, step: 1, def: 100, fmt: (v) => `${v} Mbps` },
    { k: 'alerts.floors.sw.warn', t: 'range', label: 'Switch khác (đường uplink): sàn vàng', min: 1, max: 500, step: 1, def: 10, fmt: (v) => `${v} Mbps` },
    { k: 'alerts.floors.sw.crit', t: 'range', label: 'Switch khác: sàn đỏ', min: 2, max: 1000, step: 1, def: 50, fmt: (v) => `${v} Mbps` },
    { k: 'alerts.floors.port.warn', t: 'range', label: 'Cổng có thiết bị: sàn vàng', min: 0.1, max: 200, step: 0.1, def: 5, fmt: (v) => `${v} Mbps` },
    { k: 'alerts.floors.port.crit', t: 'range', label: 'Cổng có thiết bị: sàn đỏ', min: 0.5, max: 500, step: 0.5, def: 30, fmt: (v) => `${v} Mbps` },
  ] },
  { id: 'isp', title: '🌐 Nhà mạng (ISP)', toggle: 'isp', toggleLabel: 'Hiện node ISP',
    toggleHint: 'Node chỉ xuất hiện khi được bật ở đây.', fields: [
    { k: 'isp.name', t: 'text', label: 'Tên hiển thị', ph: 'Viettel' },
    { k: 'isp.logo', t: 'text', label: 'Logo (đường dẫn ảnh)', ph: '/local/logo/viettel.png' },
    { k: 'isp.status', t: 'entity', label: 'Entity trạng thái' },
    { k: 'isp.ip', t: 'text', label: 'IP WAN (entity hoặc IP cố định)', ph: 'sensor.wan_public_ip',
      hint: 'Hiện ở dòng 2 của node ISP. Nhập entity_id (ví dụ sensor.wan_public_ip) hoặc một IP ghi cố định.' },
    { k: 'isp.delay', t: 'entity', label: 'Entity độ trễ (ms) — hiện khi rê chuột vào node' },
    { k: 'isp.loss', t: 'entity', label: 'Entity mất gói (%) — hiện khi rê chuột vào node' },
  ] },
  { id: 'pfsense', title: '🛡️ pfSense', toggle: 'pfsense', toggleLabel: 'Hiện node pfSense',
    toggleHint: 'Node chỉ xuất hiện khi được bật ở đây.', fields: [
    { k: 'pfsense.name', t: 'text', label: 'Tên hiển thị', ph: 'pfSense' },
    { k: 'pfsense.ip', t: 'text', label: 'IP (entity hoặc IP cố định)', ph: '192.168.1.x',
      hint: 'Hiện ở dòng 2 của node pfSense. Bỏ trống thì không hiện dòng 2.' },
    { k: 'pfsense.logo', t: 'text', label: 'Logo (đường dẫn ảnh)', ph: '/local/logo/pfsense.png' },
    { k: 'pfsense.cpu', t: 'entity', label: 'Entity CPU (%) — hiện khi rê chuột vào node' },
    { k: 'pfsense.ram', t: 'entity', label: 'Entity RAM (%) — hiện khi rê chuột vào node' },
    { k: 'pfsense.states', t: 'entity', label: 'Entity số state — hiện khi rê chuột vào node' },
  ] },
  { id: 'core', title: '🖧 Switch lõi', fields: [
    { k: 'core.switch', t: 'text', label: 'Tên switch lõi (đúng tên thiết bị trong HA)', ph: 'SW-CORE',
      hint: 'Tên thiết bị trong integration SNMP Switch Manager. Không phân biệt hoa thường, có thể bỏ đuôi .home.lan.' },
    { k: 'core.name', t: 'text', label: 'Tên hiển thị', ph: 'SW-CORE' },
    { k: 'core.ip', t: 'text', label: 'IP (chỉ để hiển thị)', ph: '192.168.1.x' },
    { k: 'core.logo', t: 'text', label: 'Logo (đường dẫn ảnh)', ph: '/local/logo/switch.png' },
    { k: 'core.ports', t: 'csv', label: 'Cổng nối lên pfSense (cách nhau bằng dấu phẩy)', ph: 'Gi1/0/15, Gi1/0/16',
      hint: 'Nối LACP nhiều cổng thì khai báo hết, tốc độ được cộng lại. Các cổng này không hiện như thiết bị.' },
  ] },
  { id: 'links', title: '🔗 Đường nối giữa các switch', fields: [
    { k: 'links', t: 'objlist', label: 'Danh sách đường nối (switch cha → switch con)', addLabel: 'Thêm đường nối',
      title: (it) => `${it.parent || '?'} → ${it.child || '?'}`,
      cols: [
        { k: 'parent', label: 'Switch cha', ph: 'SW-CORE' },
        { k: 'parent_port', label: 'Cổng bên switch cha', ph: 'Gi1/0/13' },
        { k: 'child', label: 'Switch con', ph: 'CISCO_SW#3' },
        { k: 'child_port', label: 'Cổng bên switch con', ph: 'Gi1/0/2' },
        { k: 'child_ip', label: 'IP switch con (chỉ để hiển thị)', ph: '192.168.1.x' },
        { k: 'down', t: 'entity', label: 'Sensor tải xuống (chỉ khi switch không có trong integration)' },
        { k: 'up', t: 'entity', label: 'Sensor tải lên (như trên)' },
        { k: 'status', t: 'entity', label: 'Sensor trạng thái link (như trên, 1 = up, 2 = down)' },
      ],
      hint: 'Để trống các sensor thì card tự lấy tốc độ từ cổng của switch cha (không có thì từ cổng switch con). "Tải xuống" = dữ liệu đi từ switch cha xuống switch con.' },
  ] },
  { id: 'switches', title: '➕ Switch thêm tay', fields: [
    { k: 'switches', t: 'objlist', label: 'Switch không có trong integration (dùng sensor YAML)', addLabel: 'Thêm switch',
      title: (it) => it.name || '?',
      cols: [
        { k: 'name', label: 'Tên', ph: 'SG2210P-1' },
        { k: 'model', label: 'Model', ph: 'SG2210P' },
        { k: 'ip', label: 'IP (chỉ để hiển thị)', ph: '192.168.1.x' },
        { k: 'logo', label: 'Logo (đường dẫn ảnh)', ph: '/local/logo/tplink.png' },
      ],
      hint: 'Switch thêm tay chỉ xuất hiện trên sơ đồ khi có đường nối ở nhóm trên.' },
  ] },
  { id: 'wan', title: '📶 Đường WAN', fields: [
    { k: 'wan.down', t: 'entities', label: 'WAN tải xuống (có thể nhiều entity, sẽ cộng lại)',
      hint: 'Đơn vị tốc độ được tự quy đổi theo unit_of_measurement của sensor.' },
    { k: 'wan.up', t: 'entities', label: 'WAN tải lên' },
    { k: 'speedtest.down', t: 'entity', label: 'Speedtest tải xuống (hiện ở header)',
      hint: 'Kết quả lần đo gần nhất của integration Speedtest.net. Chỉ cần khai báo một trong ba entity là hiện ô Speedtest.' },
    { k: 'speedtest.up', t: 'entity', label: 'Speedtest tải lên' },
    { k: 'speedtest.ping', t: 'entity', label: 'Speedtest ping (ms)' },
  ] },
  { id: 'ports', title: '🔌 Cổng & tên thiết bị', fields: [
    { k: 'port_names', t: 'kv', label: 'Đặt tên / IP cho cổng', ph: 'SW-CORE:Gi1/0/6 = Frigate | 192.168.1.x',
      hint: 'Mỗi dòng: switch:cổng = tên | IP (phần IP có thể bỏ). Cổng có mô tả trên switch dạng FRIGATE-192.168.1.x thì card tự lấy tên và IP, không cần khai báo ở đây.' },
    { k: 'exclude_switches', t: 'csv', label: 'Ẩn các switch (cách nhau bằng dấu phẩy)', ph: 'SW-Test' },
    { k: 'exclude_ports', t: 'csv', label: 'Ẩn các cổng (cách nhau bằng dấu phẩy)', ph: 'SW-CORE:Gi1/0/8, Gi1/0/24',
      hint: 'Dạng switch:cổng, hoặc chỉ tên cổng để ẩn trên mọi switch.' },
    { k: 'switch_logo', t: 'text', label: 'Logo chung cho mọi switch', ph: '/local/logo/switch.png' },
  ] },
];
const FIELD_BY_KEY = Object.fromEntries(EDITOR_SECTIONS.flatMap((s) => s.fields).map((f) => [f.k, f]));

const EDITOR_CSS = `
  :host{display:block;padding:4px 0}
  *{box-sizing:border-box}
  .acc-wrap{border:1px solid var(--divider-color);border-radius:10px;margin-bottom:8px;overflow:hidden}
  .acc-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer;background:var(--secondary-background-color);font-size:13px;font-weight:700;color:var(--primary-text-color);user-select:none;transition:background .15s}
  .acc-head:hover{background:var(--table-row-background-color,rgba(0,0,0,.04))}
  .acc-arrow{font-size:14px;color:var(--secondary-text-color)}
  .acc-body{padding:12px 14px;border-top:1px solid var(--divider-color);background:var(--card-background-color,#fff)}
  .row{display:flex;flex-direction:column;margin-bottom:12px}
  .row:last-child{margin-bottom:0}
  .row label{font-size:12px;color:var(--secondary-text-color);margin-bottom:4px;font-weight:600}
  ha-entity-picker{display:block;width:100%}
  input[type=text]{background:var(--input-fill-color,rgba(0,0,0,.04));border:1px solid var(--divider-color,#e0e0e0);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--primary-text-color);font-family:inherit;width:100%}
  .sl-row{display:flex;align-items:center;gap:10px;margin-bottom:4px}
  .sl-row label{font-size:12px;font-weight:600;color:var(--secondary-text-color);min-width:130px}
  .sl-row input[type=range]{flex:1;accent-color:var(--primary-color)}
  .slv{font-size:12px;font-weight:700;color:var(--primary-color);min-width:42px;text-align:right}
  .bg{display:flex;gap:6px;flex-wrap:wrap}
  .ob{flex:1;min-width:60px;padding:8px 6px;border-radius:8px;border:1.5px solid var(--divider-color);background:var(--secondary-background-color);cursor:pointer;text-align:center;font-size:12px;color:var(--primary-text-color);transition:all .2s;user-select:none}
  .ob.on{border-color:var(--primary-color);background:rgba(3,169,244,.12);color:var(--primary-color);font-weight:700}
  .ob:hover{background:rgba(3,169,244,.06)}
  .hint{font-size:11px;color:var(--secondary-text-color);margin-top:4px;line-height:1.55}
  .rng{margin-bottom:12px}
  .erow{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  .erow ha-entity-picker{flex:1;min-width:0}
  .btn-del{flex-shrink:0;background:rgba(220,50,50,.12);border:1px solid rgba(220,50,50,.3);color:#c44;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;font-weight:700;transition:all .15s}
  .btn-del:hover{background:rgba(220,50,50,.25)}
  .btn-add{display:flex;align-items:center;gap:5px;margin-top:2px;background:rgba(3,169,244,.08);border:1.5px dashed rgba(3,169,244,.4);color:var(--primary-color);border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12px;font-weight:600;width:100%;justify-content:center;transition:all .15s}
  .btn-add:hover{background:rgba(3,169,244,.18)}
  textarea{background:var(--input-fill-color,rgba(0,0,0,.04));border:1px solid var(--divider-color,#e0e0e0);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--primary-text-color);font-family:ui-monospace,Menlo,Consolas,monospace;width:100%;resize:vertical}
  .olitem{border:1px solid var(--divider-color);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--secondary-background-color)}
  .olhead{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;margin-bottom:8px;color:var(--primary-text-color)}
  .olitem .row{margin-bottom:8px}
  .about{text-align:center;padding:12px 14px 8px;font-size:11px;color:var(--secondary-text-color);line-height:1.7}
  .about strong{color:var(--primary-color)}
  .coffee{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:5px 12px;border-radius:20px;text-decoration:none;font-size:11px;font-weight:700;background:linear-gradient(135deg,rgba(255,180,0,.18),rgba(255,120,0,.12));border:1px solid rgba(255,160,0,.45);color:#ffb830;box-shadow:0 2px 8px rgba(255,150,0,.15);transition:all .2s}
  .coffee:hover{background:linear-gradient(135deg,rgba(255,180,0,.32),rgba(255,120,0,.22));border-color:rgba(255,160,0,.75);transform:translateY(-1px)}
  .tip{margin:8px 0 4px;padding:10px 12px;background:var(--secondary-background-color);border-radius:8px;border:1px solid var(--divider-color);font-size:11px;color:var(--secondary-text-color);line-height:1.6}
`;

class SnmpTopoLanCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._lastFired = '';
    this._blank = {};            // số dòng entity trống đang chờ chọn, theo key
    this._open = { general: true };
    // Listener gắn một lần trên shadowRoot (ủy quyền sự kiện), không mất khi render lại
    this.shadowRoot.addEventListener('click', (e) => this._onClick(e));
    this.shadowRoot.addEventListener('input', (e) => this._onInput(e));
    this.shadowRoot.addEventListener('change', (e) => this._onChange(e));
  }

  setConfig(config) {
    this._config = config || {};
    // Config vừa do chính editor phát ra thì không cần dựng lại (tránh mất focus)
    if (JSON.stringify(this._config) === this._lastFired && this.shadowRoot.childElementCount) return;
    this._render();
  }

  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._syncPickers(); }

  _fire() {
    this._lastFired = JSON.stringify(this._config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config }, bubbles: true, composed: true,
    }));
  }

  _commit(key, value) {
    this._config = setPath(this._config, key, value);
    this._fire();
  }

  _toggle(id) {
    this._open[id] = !this._open[id];
    this._render();
  }

  // ── Sự kiện ──
  _onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const { act, k, val, id, i, kind, def } = t.dataset;
    if (act === 'head') this._toggle(id);
    else if (act === 'opt') {
      this._commit(k, kind === 'bool' ? val === '1' : kind === 'num' ? Number(val)
        : kind === 'optr' ? (val === 'auto' ? undefined : Number(def)) : val);
      this._render();
    } else if (act === 'sec') {
      this._commit(k, val === '1' ? {} : undefined);
      this._render();
    } else if (act === 'add') {
      this._blank[k] = (this._blank[k] || 0) + 1;
      this._render();
    } else if (act === 'del') {
      this._delRow(k, Number(i));
    } else if (act === 'oladd') {
      this._olAdd(k);
    } else if (act === 'oldel') this._olDel(k, Number(i));
  }

  _onInput(e) {
    const el = e.target, f = el.dataset && FIELD_BY_KEY[el.dataset.k];
    if (!f || !['range', 'optrange'].includes(f.t)) return;
    const span = this.shadowRoot.querySelector(`[data-v="${el.dataset.k}"]`);
    if (span) span.textContent = this._fmt(f, parseFloat(el.value));
  }

  _onChange(e) {
    const el = e.target;
    if (el.dataset && el.dataset.ol) {   // ô nhập trong danh sách đối tượng (links, switches)
      this._olSet(el.dataset.ol, Number(el.dataset.oi), el.dataset.ok, el.value.trim());
      return;
    }
    const f = el.dataset && FIELD_BY_KEY[el.dataset.k];
    if (!f || !['text', 'csv', 'kv', 'range', 'optrange'].includes(f.t)) return;
    let v;
    if (f.t === 'range' || f.t === 'optrange') v = parseFloat(el.value);
    else if (f.t === 'csv') v = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (f.t === 'kv') v = parseKv(el.value);
    else v = el.value.trim();
    this._commit(f.k, v);
  }

  _delRow(k, i) {
    const vals = list(getPath(this._config, k));
    if (i < vals.length) {
      const next = vals.filter((_, j) => j !== i);
      this._commit(k, next.length === 1 ? next[0] : next);
    } else this._blank[k] = Math.max(0, (this._blank[k] || 0) - 1);
    this._render();
  }

  // Nhiều entity: 1 phần tử lưu dạng chuỗi, nhiều phần tử lưu dạng mảng
  _onListPick(k, i, val) {
    const vals = list(getPath(this._config, k)).slice();
    if (i < vals.length) {
      if (vals[i] === val) return;
      if (val) vals[i] = val; else vals.splice(i, 1);
    } else if (val) {
      vals.push(val);
      this._blank[k] = Math.max(0, (this._blank[k] || 0) - 1);
    } else return;
    this._commit(k, vals.length === 1 ? vals[0] : vals);
    this._render();
  }

  // ── Danh sách đối tượng (links, switches): mỗi mục là một khối nhỏ có nhiều ô ──
  _olSet(key, i, field, value) {
    const arr = clone(list(getPath(this._config, key)));
    while (arr.length <= i) arr.push({});
    const it = arr[i] && typeof arr[i] === 'object' ? arr[i] : {};
    if (value === '' || value == null) delete it[field]; else it[field] = value;
    arr[i] = it;
    this._commit(key, arr);
  }

  _olAdd(key) {
    const arr = clone(list(getPath(this._config, key)));
    arr.push({});
    this._commit(key, arr);
    this._render();
  }

  _olDel(key, i) {
    const arr = clone(list(getPath(this._config, key))).filter((_, j) => j !== i);
    this._commit(key, arr);
    this._render();
  }

  // ── Render ──
  _fmt(f, v) { return f.fmt ? f.fmt(v) : String(v); }

  _hint(f) { return f.hint ? `<div class="hint">${f.hint}</div>` : ''; }

  _buttons(f, opts, current, kind) {
    return `<div class="bg">${opts.map(([val, text]) => `
      <div class="ob ${String(current) === String(val) ? 'on' : ''}" data-act="opt" data-k="${f.k}"
           data-kind="${kind}" data-val="${kind === 'bool' ? (val ? '1' : '0') : esc(val)}">${text}</div>`).join('')}</div>`;
  }

  _fieldHtml(f) {
    const v = getPath(this._config, f.k);
    switch (f.t) {
      case 'text':
        return `<div class="row"><label>${f.label}</label>
          <input type="text" data-k="${f.k}" placeholder="${esc(f.ph || '')}" value="${esc(v)}"/>${this._hint(f)}</div>`;
      case 'csv':
        return `<div class="row"><label>${f.label}</label>
          <input type="text" data-k="${f.k}" placeholder="${esc(f.ph || '')}" value="${esc(list(v).join(', '))}"/>${this._hint(f)}</div>`;
      case 'range': {
        const cur = v != null ? v : f.def;
        return `<div class="rng"><div class="sl-row"><label>${f.label}</label>
          <input type="range" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${cur}"/>
          <span class="slv" data-v="${f.k}">${this._fmt(f, cur)}</span></div>${this._hint(f)}</div>`;
      }
      case 'optrange': {
        const fixed = typeof v === 'number';
        const btn = (val, text, on) => `<div class="ob ${on ? 'on' : ''}" data-act="opt" data-k="${f.k}" data-kind="optr" data-val="${val}" data-def="${f.def}">${text}</div>`;
        return `<div class="row"><label>${f.label}</label>
          <div class="bg">${btn('auto', 'Tự động', !fixed)}${btn('fixed', 'Cố định', fixed)}</div>
          ${fixed ? `<div class="sl-row" style="margin-top:8px"><input type="range" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"/>
            <span class="slv" data-v="${f.k}">${this._fmt(f, v)}</span></div>` : ''}${this._hint(f)}</div>`;
      }
      case 'bool':
        return `<div class="row"><label>${f.label}</label>
          ${this._buttons(f, ON_OFF, v != null ? v : f.def, 'bool')}${this._hint(f)}</div>`;
      case 'choice':
        return `<div class="row"><label>${f.label}</label>
          ${this._buttons(f, f.opts, v != null ? v : f.def, f.num ? 'num' : 'str')}${this._hint(f)}</div>`;
      case 'entity':
        return `<div class="row"><label>${f.label}</label>
          <ha-entity-picker data-k="${f.k}" allow-custom-entity></ha-entity-picker></div>`;
      case 'entities': {
        const n = Math.max(1, list(v).length + (this._blank[f.k] || 0));
        const rows = Array.from({ length: n }, (_, i) => `<div class="erow">
          <ha-entity-picker data-k="${f.k}" data-i="${i}" allow-custom-entity></ha-entity-picker>
          <div class="btn-del" data-act="del" data-k="${f.k}" data-i="${i}" title="Xóa dòng này">✕</div></div>`).join('');
        return `<div class="row"><label>${f.label}</label>${rows}
          <div class="btn-add" data-act="add" data-k="${f.k}">＋ Thêm entity</div>${this._hint(f)}</div>`;
      }
      case 'kv':
        return `<div class="row"><label>${f.label}</label>
          <textarea data-k="${f.k}" rows="5" placeholder="${esc(f.ph || '')}">${esc(kvText(v))}</textarea>${this._hint(f)}</div>`;
      case 'objlist': {
        const items = list(v);
        const rows = items.map((it, i) => `<div class="olitem">
          <div class="olhead"><span>${esc(f.title(it || {}, i))}</span>
            <div class="btn-del" data-act="oldel" data-k="${f.k}" data-i="${i}" title="Xóa mục này">✕</div></div>
          ${f.cols.map((col) => (col.t === 'entity'
            ? `<div class="row"><label>${col.label}</label>
                <ha-entity-picker data-ol="${f.k}" data-oi="${i}" data-ok="${col.k}" allow-custom-entity></ha-entity-picker></div>`
            : `<div class="row"><label>${col.label}</label>
                <input type="text" data-ol="${f.k}" data-oi="${i}" data-ok="${col.k}" placeholder="${esc(col.ph || '')}" value="${esc(it && it[col.k])}"/></div>`)).join('')}
        </div>`).join('');
        return `<div class="row"><label>${f.label}</label>${rows}
          <div class="btn-add" data-act="oladd" data-k="${f.k}">＋ ${f.addLabel}</div>${this._hint(f)}</div>`;
      }
      default: return '';
    }
  }

  _sectionHtml(s) {
    const open = !!this._open[s.id];
    let inner = '';
    let shown = true;
    if (s.toggle) {
      shown = getPath(this._config, s.toggle) != null;
      inner += `<div class="row"><label>${s.toggleLabel}</label><div class="bg">
        <div class="ob ${shown ? 'on' : ''}" data-act="sec" data-k="${s.toggle}" data-val="1">Hiện</div>
        <div class="ob ${shown ? '' : 'on'}" data-act="sec" data-k="${s.toggle}" data-val="0">Ẩn</div></div>
        <div class="hint">${s.toggleHint}</div></div>`;
    }
    if (shown && open) inner += s.fields.map((f) => this._fieldHtml(f)).join(''); // section đóng thì không dựng (đỡ tạo picker)
    return `<div class="acc-wrap">
      <div class="acc-head" data-act="head" data-id="${s.id}"><span>${s.title}</span>
        <span class="acc-arrow" id="arrow-${s.id}">${open ? '▾' : '▸'}</span></div>
      <div class="acc-body" id="body-${s.id}" style="display:${open ? 'block' : 'none'}">${inner}</div></div>`;
  }

  _render() {
    this.shadowRoot.innerHTML = `<style>${EDITOR_CSS}</style>
      <div class="about">
        🌐 <strong>SNMP Topo LAN v${CARD_VERSION}</strong> — Sơ đồ mạng LAN<br/>
        Thiết kế bởi <strong>@doanlong1412</strong> 🇻🇳<br/>
        <a class="coffee" href="https://www.paypal.com/paypalme/doanlong1412" target="_blank" rel="noopener">☕ Mời mình ly cà phê</a>
      </div>
      ${EDITOR_SECTIONS.map((s) => this._sectionHtml(s)).join('')}
      <div class="tip">💡 Mẹo: bấm nút ✥ trên card để kéo thả ISP / pfSense / các switch; vị trí được lưu riêng cho chế độ ngang và chế độ dọc. Đặt mô tả cổng trên switch dạng <code>FRIGATE-192.168.1.x</code> để card tự hiện tên và IP của thiết bị.</div>`;
    this._bindPickers();
    this._syncPickers();
  }

  _bindPickers() {
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((p) => {
      p.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        const k = p.dataset.k, val = (ev.detail && ev.detail.value) || '';
        if (p.dataset.ol) { this._olSet(p.dataset.ol, Number(p.dataset.oi), p.dataset.ok, val); return; }
        if (p.dataset.i !== undefined) { this._onListPick(k, Number(p.dataset.i), val); return; }
        if (val === (getPath(this._config, k) || '')) return; // đồng bộ giá trị, không phải người dùng đổi
        this._commit(k, val);
      });
    });
  }

  _syncPickers() {
    if (!this._hass || !this.shadowRoot) return;
    const apply = () => {
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((p) => {
        if (!p._init) { p.hass = this._hass; p._init = true; } // chỉ gán một lần, tránh picker render lại mỗi lần HA đổi state
        const raw = p.dataset.ol ? undefined : getPath(this._config, p.dataset.k);
        const val = (p.dataset.ol ? (list(getPath(this._config, p.dataset.ol))[Number(p.dataset.oi)] || {})[p.dataset.ok]
          : p.dataset.i !== undefined ? list(raw)[Number(p.dataset.i)] : raw) || '';
        if (val && p.value !== val) { p.value = val; p.setAttribute('value', val); }
      });
    };
    apply();
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }
}

customElements.define(CARD_TAG, SnmpTopoLanCard);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, SnmpTopoLanCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'SNMP Topo LAN',
  description: 'Topo LAN ISP → pfSense → switch lõi → switch → cổng với tốc độ realtime (SNMP Switch Manager)',
});
console.info(`%c SNMP-TOPO-LAN-CARD %c v${CARD_VERSION} `, 'color:#fff;background:#03a9f4;font-weight:700', 'color:#03a9f4');
