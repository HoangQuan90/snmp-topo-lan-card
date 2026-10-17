# 🌐 SNMP Topo LAN Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
![version](https://img.shields.io/badge/version-1.0.0-blue)
![HA](https://img.shields.io/badge/Home%20Assistant-2024.6+-green)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

> 🇻🇳 **Tiếng Việt (bản chính):** [README.md](README.md) · 🇬🇧 **English version** (secondary, translated from the Vietnamese original)

A custom Home Assistant Lovelace card that draws your whole LAN as a live tree: **ISP → pfSense → core switch → other switches → ports with devices**. Animated flow lines scale in speed and thickness with real bandwidth, the layout is drag-and-drop, and there are traffic alerts and a visual config editor.

Data comes from the **SNMP Switch Manager** integration. For weak switches that cannot run through the integration, use plain SNMP sensors in YAML. **No extra frontend plugins, fully configurable from the built-in editor.**

> 📌 **Conventions:** IP addresses are written as `192.168.1.x` (replace `x` with the real device IP). The community string is written as `<COMMUNITY>` and kept only in `secrets.yaml`. Switch names used in examples: `SW-CORE`, `Switch1-251`, `Switch2-252`, `SF220`.

---

## 📸 Preview

![SNMP Topo LAN Card Preview](assets/preview.png)

## 🎛️ Visual Config Editor

![SNMP Topo LAN Card Editor](assets/editor-preview.png)

---

## ✨ Features (v1.0.0)

### 🎨 Display & interface
- 🌳 **Tree diagram** ISP → pfSense → core switch → child switches → ports with devices, drawn horizontally or vertically
- ✨ **Animated flow lines** in `dash` or `galaxy` style; thickness, speed and brightness follow bandwidth; idle links stay still to save CPU
- 🏷️ **Link labels** `↓ ↑` showing speed on every switch-to-switch link
- 🌗 **Glass / Neon**: Glass follows the HA theme (light/dark), Neon is a fixed dark palette, switch with one header button
- 🪟 **Node opacity & blur** so flow lines do not show through text
- 📊 **Header stats**: ports up, total download/upload with a sparkline, latest **Speedtest** result
- 🔍 **Search** ports by name, IP or port number; 🔎 **Zoom & fullscreen**

### 🧩 Free layout
- ✋ **Drag everything** (ISP, pfSense, core, every switch) in arrange mode `✥`
- 📌 **Pin device columns** by dragging their header; pinned columns work independently
- 🖧 **Independent core switch column**, opens and closes on its own
- ➡️ **Flow lines enter ports from the side**, never crossing other blocks
- 💾 **Saved per HA user** (synced across devices, `localStorage` fallback); horizontal and vertical layouts are stored separately
- ↩️ **One-click reset**; double-click a column header to unpin it

### 🔌 Smart ports
- 🤖 **Automatic device list**: only ports with link and traffic are shown; inter-switch ports hide themselves
- 🏷️ **Naming from port description**: `FRIGATE-192.168.1.x` is split into name + IP
- ✏️ **Manual naming** with `port_names`, with a ready-made field in the editor
- 🙈 Hide switches/ports, sort by port/name/traffic, limit ports per switch
- 🔄 Open up to 3 switches at once, or let the card **auto-rotate** through switches

### 🔔 Traffic alerts
- 🟡🔴 **Yellow/red glow** when traffic exceeds both the tier floor **and** yesterday's average times a factor
- 🛡️ **No false alarms**: small devices only glow above the floor; the glow stops as soon as the heavy traffic ends

### 🎛️ Visual editor
Entity pickers for ISP/WAN/pfSense/Speedtest, a link composer, sliders for opacity/blur/zoom/height/alert thresholds, accordion sections.

---

## 📋 Requirements

| | |
|---|---|
| Home Assistant | 2024.6+ |
| Integration | **[SNMP Switch Manager](https://github.com/OtisPresley/snmp-switch-manager)** (via HACS) with **Bandwidth Collection** enabled. Weak switches can use YAML sensors instead |
| Account | **Administrator**, because the card reads the device and entity registry |
| pfSense | Optional: ISP status, WAN speed, CPU/RAM/state |
| Speedtest.net | Optional: header Speedtest tile |
| Recorder | Optional: used for "yesterday's average" in alerts |

---

## 📦 Installing the card

### Option 1: HACS (recommended)

1. Add the Custom Repository:

   [![Open HACS Repository](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=doanlong1412&repository=snmp-topo-lan-card&category=plugin)

   If the button does not work: **HACS → Frontend → ⋮ → Custom repositories** → URL `https://github.com/doanlong1412/snmp-topo-lan-card` → Type **Dashboard** → Add.
2. Search for **SNMP Topo LAN** → **Install**.
3. Hard-reload the browser (`Ctrl+Shift+R`).

### Option 2: Manual

1. Download [`snmp-topo-lan-card.js`](https://github.com/doanlong1412/snmp-topo-lan-card/releases/latest).
2. Copy it to `/config/www/community/snmp-topo-lan-card/snmp-topo-lan-card.js`.
3. **Settings → Dashboards → Resources → Add resource**:
   ```
   URL:  /local/community/snmp-topo-lan-card/snmp-topo-lan-card.js?v=1.0.0
   Type: JavaScript module
   ```
4. Hard-reload the browser. Change the number after `?v=` whenever you replace the file to avoid caching.

---

## 🛠️ Preparing the data

Data flow: **Switch (read-only SNMP) → SNMP Switch Manager (or YAML sensors) → HA entities → card**.

### Step 1: Enable read-only SNMP on every switch

Use SNMP v2c with a **read-only (RO)** community, restricted to the Home Assistant IP. Never use RW so nobody can switch a port off by accident.

**Cisco IOS (example `SW-CORE`):**

```
ip access-list standard SNMP-HA
 permit host 192.168.1.x        ! Home Assistant IP
 deny any
snmp-server community <COMMUNITY> RO SNMP-HA
snmp-server ifindex persist
end
write memory
```

`snmp-server ifindex persist` keeps ifIndex stable across reboots.

**TP-Link SG2210P:** web UI, SYSTEM → SNMP: enable SNMP, create a **Read-only** community, click **Apply** and then **Save**. Forgetting Save is the most common reason the switch does not answer.

**Cisco SF220 and other vendors:** enable the SNMP service in the web UI, create a Read-only community, set the management station to the Home Assistant IP, and save the configuration to startup.

Keep the community in `secrets.yaml`, never in screenshots or public issues:

```yaml
# secrets.yaml
snmp_swpoe_community: "<COMMUNITY>"
```

**Check that the switch answers** (from the HA terminal or any machine with `snmpwalk`):

```bash
snmpwalk -v2c -c '<COMMUNITY>' 192.168.1.x 1.3.6.1.2.1.31.1.1.1.1
```

- A list of ports comes back: the switch is fine.
- `Timeout`: community not applied/saved, SNMP is off, or the ACL does not allow the HA IP.

This also reveals each port's **ifIndex** (the number at the end of the OID). Always take ifIndex from `snmpwalk`, never guess.

---

### Step 2: Add switches to the SNMP Switch Manager integration

1. **HACS** → add `https://github.com/OtisPresley/snmp-switch-manager` → Download → restart Home Assistant.
2. **Settings → Devices & Services → Add Integration → SNMP Switch Manager** → enter the IP and community, choose **SNMP v2c**, Submit.
3. Wait about a minute, open the device and look at **Controls** to see the displayed port names (needed for include rules and for name mapping).
4. **Configure → Bandwidth Sensors** (for each switch):

| Option | Value |
|---|---|
| Enable Bandwidth Collection | ✅ On |
| Bandwidth Data As | **Sensors (history)** |
| Poll Interval | `30` seconds |

5. **Include rules**: Action **Add**, leave Existing rule empty, Match **Starts with**, enter the Value, Submit. Do not tick "Go back (discard changes)".

| Switch | Rules | Value |
|---|---|---|
| `SW-CORE` (Cisco C1000) | 1 | `Gi1/0/` |
| `SF220` | 2 | `FastEthernet` and `GigabitEthernet` |
| `Switch1-251`, `Switch2-252` (SG2210P) | 1 each | `gigabitEthernet` |

> ⚠️ The Value must match the **displayed name** in the device's *Controls*, not the name from `snmpwalk`. Matching is case-insensitive. If a rule yields no sensors, change Match to **Contains** with `1/0/` (SG2210P) or `Ethernet` (SF220).

6. **Verify**: wait 1 to 2 minutes (throughput is `Unknown` at first because two reads are needed). The device's **Diagnostic** section has 4 sensors per port: RX/TX Throughput (bit/s) and RX/TX Total. If a YAML sensor already measures the same uplink, multiply its value (bytes/s) by 8 and compare; a match within a few percent is correct.

**Changing the community later:** if you change it on the switch but the integration keeps the old one, the switch ignores the queries. Go to **Configure → Connection & Name → SNMP v2c → SNMP Community Override**, enter the new string, Submit, and wait about a minute. If Configure is greyed out or errors, delete the entry and add it again with the new IP and community.

---

### Step 3: Keep the `switch.*` port entities

The card reads port names and link state from these entities.

- ✅ For a tidy dashboard, **Hide** them: Settings → Devices & Services → Entities → filter `switch.` → select all → **Hide selected**.
- ❌ **Do not Disable** them, or the card loses port names and link state.

---

### Step 4: Label ports on the switches *(optional but recommended)*

Give every port with a device a `NAME-IP` description and the card shows the name and IP automatically:

```
interface Gi1/0/6
 description FRIGATE-192.168.1.x
interface Gi1/0/11
 description HASS-192.168.1.x
interface Gi1/0/12
 description NAS-192.168.1.x
```

A port that still has the default description (for example `GigabitEthernet1/0/6`) counts as unnamed. If a switch cannot set descriptions, use `port_names` (see **Naming ports**).

**Finding which device is on which port:** read the MAC table (SG2210P: SWITCHING → MAC Address → Address Table; Cisco: `show mac address-table`), match the MACs against the pfSense DHCP leases to get IPs, then record a table of (port, MAC, IP, name).

---

### 🔧 When the integration fails or times out: use YAML sensors

Some small switches (for example SG2210P) have a weak SNMP agent that cannot handle the number of queries the integration sends, so they time out or Configure errors. In that case read each port directly with plain SNMP sensors. You can mix: capable switches use the integration, weak ones use YAML.

**Template for one port (5 entities).** Replace `<NAME>` (for example `swpoe1_p3`), `<IP>`, `<IFINDEX>`:

```yaml
# configuration.yaml → sensor:
  - {platform: snmp, name: <NAME>_in_bytes,  host: <IP>, community: !secret snmp_swpoe_community, version: 2c, baseoid: 1.3.6.1.2.1.31.1.1.1.6.<IFINDEX>,  unit_of_measurement: B, scan_interval: 30, accept_errors: true}
  - {platform: snmp, name: <NAME>_out_bytes, host: <IP>, community: !secret snmp_swpoe_community, version: 2c, baseoid: 1.3.6.1.2.1.31.1.1.1.10.<IFINDEX>, unit_of_measurement: B, scan_interval: 30, accept_errors: true}
  - {platform: snmp, name: <NAME>_status,    host: <IP>, community: !secret snmp_swpoe_community, version: 2c, baseoid: 1.3.6.1.2.1.2.2.1.8.<IFINDEX>,       scan_interval: 60, accept_errors: true}
  - {platform: derivative, name: <NAME>_in_rate,  unique_id: <NAME>_in_rate,  source: sensor.<NAME>_in_bytes,  unit_time: s, time_window: "00:01:00", round: 0}
  - {platform: derivative, name: <NAME>_out_rate, unique_id: <NAME>_out_rate, source: sensor.<NAME>_out_bytes, unit_time: s, time_window: "00:01:00", round: 0}
```

- `1.3.6.1.2.1.31.1.1.1.6` and `.10` are the 64-bit byte counters (`ifHCInOctets`, `ifHCOutOctets`); `1.3.6.1.2.1.2.2.1.8` is the port status (`1` = up, `2` = down).
- Name entities like `swpoe1_p3_in_rate`, `swpoe2_p5_out_rate`, `swpoe1_p2_status`.
- **SG2210P:** ifIndex = 49152 + port number (port 1 = `49153`, SFP1 port 9 = `49161`, SFP2 port 10 = `49162`). Ports 1 and 9 were verified with `snmpwalk`; the others are inferred from the rule, so verify them. Other vendors or models may use a different rule.
- For uplinks you can poll faster: `scan_interval: 15` for bytes, `30` for status, `time_window: "00:00:30"`.

**Generate ports 1 to 8 of two SG2210P switches (80 entities)** with Python, then paste the output into `configuration.yaml`:

```python
for sw, host in (("swpoe1", "192.168.1.x"), ("swpoe2", "192.168.1.x")):
    for p in range(1, 9):
        i, n = 49152 + p, f"{sw}_p{p}"
        s = f"  - {{platform: snmp, name: {n}"
        c = f"host: {host}, community: !secret snmp_swpoe_community, version: 2c"
        print(f"{s}_in_bytes, {c}, baseoid: 1.3.6.1.2.1.31.1.1.1.6.{i}, unit_of_measurement: B, scan_interval: 30, accept_errors: true}}")
        print(f"{s}_out_bytes, {c}, baseoid: 1.3.6.1.2.1.31.1.1.1.10.{i}, unit_of_measurement: B, scan_interval: 30, accept_errors: true}}")
        print(f"{s}_status, {c}, baseoid: 1.3.6.1.2.1.2.2.1.8.{i}, scan_interval: 60, accept_errors: true}}")
        for d in ("in", "out"):
            print(f"  - {{platform: derivative, name: {n}_{d}_rate, unique_id: {n}_{d}_rate, source: sensor.{n}_{d}_bytes, unit_time: s, time_window: \"00:01:00\", round: 0}}")
```

**Notes when using YAML:**
- After pasting: Developer Tools → YAML → Check Configuration, then restart. `rate` sensors need at least two reads, so wait 1 to 2 minutes.
- Each switch receives about 24 small queries every 30 to 60 seconds. If `snmpwalk` or the switch web UI becomes slow, raise `scan_interval` to 60.
- YAML sensors report **bytes/s**, integration sensors report **bit/s**. The card converts units automatically when you set `down`/`up` in `links`.
- If your HA version does not accept the YAML `derivative` platform, create the equivalent with a Derivative helper using the same source and time window.
- For a manually declared switch the card reads only the **uplink** (see **Manual switch** in the examples). Port 1 to 8 sensors are for your own dashboards or history.

---

## ⚙️ Card configuration

### Add the card to a dashboard

```yaml
type: custom:snmp-topo-lan-card
```

Click **✏️ Edit** to open the Config Editor:

| # | Section | Contents |
|---|---------|----------|
| 1 | ⚙️ General | Title, orientation, height, ports per switch, sorting, link labels, drag permission |
| 2 | 🎨 Appearance | Glass/Neon, blur, node opacity, flow style, zoom |
| 3 | 🔁 Auto-rotate | Mode, count, interval, skip empty switches |
| 4 | 🔔 Traffic alerts | Glow factors and per-tier floors |
| 5 | 🌐 ISP | Name, logo, WAN IP, status, latency, packet loss |
| 6 | 🛡️ pfSense | Name, IP, logo, CPU, RAM, states |
| 7 | 🖧 Core switch | Switch name, IP, ports uplinking to pfSense |
| 8 | 🔗 Switch links | Parent → child, ports, optional sensors |
| 9 | ➕ Manual switches | Switches not in the integration |
| 10 | 📶 WAN & Speedtest | WAN speed and Speedtest sensors |
| 11 | 🔌 Ports & device names | Port names/IPs, hidden switches/ports, shared logo |

---

## 🖱️ Using the card

| Action | Result |
|---|---|
| **Click a switch** | Opens its device-port column; click again to close |
| **Click the core switch** | Opens its own column, not counted in "switches open at once" |
| **✥ button** | Enter arrange mode and drag any node anywhere |
| **Drag a column header** | Pin the port column where you drop it (📌); double-click to unpin |
| **✓ / ↺ buttons** | Save layout / reset to default |
| **↻ button** | Toggle auto-rotate (remembered per user) |
| **🔍 button** | Search ports by name, IP or port number |
| **Hover a node** | Tooltip: model, ports up, ping, CPU/RAM, link speed |
| **`Ctrl` + wheel** | Zoom (`wheel_zoom: always` zooms without `Ctrl`) |
| **`Shift` + wheel** | Scroll horizontally |

> **Direction convention:** `↓` is data going from pfSense/core **down** to devices, `↑` is the opposite. If the arrows look reversed, set `swap_rx_tx: true`.

---

## 🏷️ Naming and name mapping

### Mapping rules (the most important part)

| In the card | Must match | Notes |
|---|---|---|
| `core.switch`, `parent`, `child`, prefix in `port_names` | Device name in HA (Settings → Devices & Services) | Case-insensitive, domain suffix optional: `SW-CORE.home.lan` → `SW-CORE` |
| `parent_port`, `child_port`, `core.ports`, part after `:` in `port_names` | Port name shown in the device's *Controls* | Cisco `Gi1/0/6`; SG2210P `gigabitEthernet 1/0/2`; `Gi1/0/6` and `GigabitEthernet1/0/6` are the same port |
| `switches[].name` (manual switch) | A name you choose, reused in `links` | Only for switches not in the integration |

### Three ways to set display names

Priority order: `port_names` → port description → the port's own name.

**1. Port description on the switch** *(recommended)*: `description FRIGATE-192.168.1.x` → name `FRIGATE`, IP `192.168.1.x`.

**2. `port_names` in the card** (or the "Port name / IP" field in the editor):

```yaml
port_names:
  "SW-CORE:Gi1/0/6": "Frigate | 192.168.1.x"
  "SW-CORE:Gi1/0/12": "NAS | 192.168.1.x"
  "Switch1-251:gigabitEthernet 1/0/2": "AP_Living | 192.168.1.x"
```

In the editor field, one port per line, no YAML quotes needed: `SW-CORE:Gi1/0/6 = Frigate | 192.168.1.x`.

- The part after `|` appears on line 2 of the node; drop it for no second line.
- Quote YAML keys when the name contains `#` or spaces.
- **Icon by name:** *camera / NVR / Frigate / doorbell* → camera; *NAS / server / Proxmox / VM / Docker / hass* → server; *AP / UniFi / Wi-Fi* → access point; *hub / switch / SG… / SF…* → switch; *PC / laptop* → laptop; anything else → Ethernet port.
- To pick an icon yourself, use the object form (YAML only; the editor field accepts just `name | IP`):

```yaml
port_names:
  "SW-CORE:Gi1/0/11":
    name: Proxmox
    ip: 192.168.1.x
    icon: mdi:server
```

**3. Hide what you do not want:**

```yaml
exclude_switches: [SW-Test]
exclude_ports: ["SW-CORE:Gi1/0/8", "Gi1/0/24"]   # a bare "Gi1/0/24" hides it on every switch
```

> Ports used as uplinks (the core `ports` and every entry in `links`) are hidden from the device list automatically.

---

## 🔌 Entity & option reference

### Card-level options

| Key | Type | Default | Description |
|---|---|---|---|
| `title` | string | — | Card title |
| `subtitle` | string | `LAN Topology` | Line under the title |
| `orientation` | string | `horizontal` | `horizontal` or `vertical` |
| `height` | number / `auto` | `auto` | Card height (px, 100–2000); fixed height scrolls inside the card |
| `client_columns` | number | `2` | Switches open at once (1–3), core excluded |
| `max_ports` | number | `24` | Max ports shown per switch |
| `sort_clients` | string | `port` | `port`, `name` or `traffic` |
| `hide_idle` | boolean | `false` | Hide ports below 200 bps |
| `show_down_ports` | boolean | `false` | Also show ports without link |
| `link_labels` | boolean | `true` | Show `↓ ↑` on links |
| `swap_rx_tx` | boolean | `false` | Reverse `↓ ↑` |
| `layout_edit` | boolean | `true` | Allow drag and drop |
| `layout_id` | string | — | Separate layout storage when several cards share a title |
| `style` | string | `glass` | `glass` or `neon` |
| `style_toggle` | boolean | `true` | Style button in the header |
| `flow_style` | string | `dash` | `dash` or `galaxy` |
| `transparent` | boolean | `true` | Transparent card background (Glass only) |
| `blur` | number | `6` | Background blur (px, 0–20, Glass only) |
| `node_blur` | number | `0` | Glass blur on nodes (px, 0–12) |
| `node_opacity` | number | `80` | Node opacity (%); raise it so flow lines do not show through text |
| `active_threshold_bps` | number | `2000` | Links below this stay still |
| `hide_scrollbar` | boolean | `true` | Hide the scrollbar (wheel/touch still scroll) |
| `show_zoom` / `zoom` / `wheel_zoom` | bool / number / string | `true` / `1` / `ctrl` | Zoom buttons, initial level 0.3–1.6, `ctrl` or `always` |
| `switch_logo` | string | — | One shared logo for all switches |
| `exclude_switches`, `exclude_ports`, `port_names`, `links`, `switches` | list / map | empty | See the matching sections |

### `core`: core switch *(required)*

| Key | Description |
|---|---|
| `switch` | **Required.** Device name in HA |
| `name`, `ip`, `logo` | Display name, IP shown on the node (display only), image path such as `/local/logo/switch.png` |
| `ports` | Core ports facing pfSense. For multi-port LACP list them all; speeds are summed |

### `links[]`: switch → switch

| Key | Description |
|---|---|
| `parent`, `parent_port` | Parent switch (closer to core) and its port |
| `child`, `child_port`, `child_ip`, `logo` | Child switch, its uplink port, IP shown on the node, logo |
| `down` / `up` | Speed sensors, only for switches **not** in the integration. `down` = data from parent to child |
| `status` | Link status sensor, `1` = up, `2` = down |

> Leave `down`/`up` empty and speed is taken from the parent switch's port (or the child's port if the parent has none).

### `switches[]`: manual switches

| Key | Description |
|---|---|
| `name` | Switch name (used in `links`) |
| `model`, `ip`, `logo` | Model (tooltip), IP (display only), logo |

> A manual switch only appears when a `links` entry points to it. Do not declare it here if the integration already has that switch, or you will see two nodes.

### `isp`, `pfsense`, `wan`, `speedtest`

| Key | Description |
|---|---|
| `isp.name` / `isp.logo` | ISP node name and logo (the node only shows when an `isp` block exists) |
| `isp.ip` | **WAN IP**: an entity (for example `sensor.wan_public_ip`) or a fixed IP |
| `isp.status` | Online status, drives the green/grey dot |
| `isp.delay` / `isp.loss` | Ping (ms) and packet loss (%), shown in the tooltip |
| `pfsense.name` / `logo` / `ip` | Name, logo, entity or fixed IP (line 2) |
| `pfsense.cpu` / `ram` / `states` | CPU %, RAM %, state count, shown in the tooltip |
| `wan.down` / `wan.up` | WAN speed; several entities (list) are summed |
| `speedtest.down` / `up` / `ping` | Latest Speedtest in the header; one entity is enough to show the tile |

Supported speed units: `bit/s`, `kbit/s`, `Mbit/s`, `Gbit/s`, `B/s`, `kB/s`, `KiB/s`, `MB/s`, `MiB/s`, `GB/s`.

### `alerts`: traffic glow

| Key | Default | Description |
|---|---|---|
| `alerts.enabled` | `true` | Turn the glow on/off |
| `alerts.factor_warn` / `factor_crit` | `2` / `4` | Yellow/red when traffic > yesterday's average × this number |
| `alerts.floors.infra.warn` / `crit` | `20` / `100` Mbps | Floors for ISP, pfSense, core switch |
| `alerts.floors.sw.warn` / `crit` | `10` / `50` Mbps | Floors for other switches |
| `alerts.floors.port.warn` / `crit` | `5` / `30` Mbps | Floors for ports with devices |

> A node only glows when traffic exceeds **both** the floor and the factor, so rarely used devices never raise false alarms.

### `auto`: auto-rotate switches

| Key | Default | Description |
|---|---|---|
| `auto.mode` | `single` | `single` or `multi` |
| `auto.count` | `2` | Switches per step when `multi` (1–3) |
| `auto.interval` | `6` | Seconds between changes (2–60) |
| `auto.skip_empty` | `true` | Skip switches without devices |
| `auto.pause_on_tap` | `20` | Seconds to pause after you open a switch yourself (0 = never pause) |

---

## 📝 YAML examples

### Full (all switches in the integration)

```yaml
type: custom:snmp-topo-lan-card
title: LAN Network
orientation: horizontal
height: 630
flow_style: galaxy
node_opacity: 85

isp:
  name: ISP
  logo: /local/Icon/network/isp.png
  ip: sensor.wan_public_ip
  status: sensor.pfsense_gateway_wan_pppoe_status
  delay: sensor.pfsense_gateway_wan_pppoe_delay
  loss: sensor.pfsense_gateway_wan_pppoe_loss
pfsense:
  name: pfSense
  ip: 192.168.1.x
  logo: /local/Icon/network/firewall.png
  ram: sensor.pfsense_memory_used
  states: sensor.pfsense_pf_state_table_used
wan:
  down: sensor.pfsense_interface_wan_inbytes_kilobytes_per_second
  up: sensor.pfsense_interface_wan_outbytes_kilobytes_per_second
speedtest:
  down: sensor.speedtest_download
  up: sensor.speedtest_upload
  ping: sensor.speedtest_ping

core:
  switch: SW-CORE
  name: SW-CORE
  ip: 192.168.1.x
  ports: [Gi1/0/15, Gi1/0/16]        # LACP uplink to pfSense

links:
  - parent: SW-CORE
    parent_port: Gi1/0/9
    child: Switch1-251
    child_port: gigabitEthernet 1/0/9
    child_ip: 192.168.1.x
  - parent: SW-CORE
    parent_port: Gi1/0/10
    child: Switch2-252
    child_port: gigabitEthernet 1/0/9
    child_ip: 192.168.1.x
  - parent: SW-CORE
    parent_port: Gi1/0/13
    child: SF220
    child_port: GigabitEthernet1
    child_ip: 192.168.1.x

port_names:
  "SW-CORE:Gi1/0/6": "Frigate | 192.168.1.x"
  "SW-CORE:Gi1/0/11": "Home Assistant | 192.168.1.x"
  "SW-CORE:Gi1/0/12": "NAS | 192.168.1.x"
  "SF220:FastEthernet4": "Main gate camera | 192.168.1.x"
  "Switch1-251:gigabitEthernet 1/0/2": "AP_Living | 192.168.1.x"
  "Switch2-252:gigabitEthernet 1/0/1": "UniFi Cloud Key | 192.168.1.x"
```

### Minimal

```yaml
type: custom:snmp-topo-lan-card
title: My Home Network
core:
  switch: SW-CORE
  ports: [Gi1/0/1]
links:
  - parent: SW-CORE
    parent_port: Gi1/0/24
    child: SW-OFFICE
```

### Vertical layout

```yaml
type: custom:snmp-topo-lan-card
title: LAN Network
orientation: vertical
height: 720
core:
  switch: SW-CORE
  ports: [Gi1/0/15, Gi1/0/16]
```

### 🧱 Manual switch without the integration

Use this when a switch cannot be read through the integration and you created uplink sensors in YAML (see **When the integration fails**):

```yaml
links:
  - parent: SW-CORE
    parent_port: Gi1/0/9
    child: SG2210P-1
    child_ip: 192.168.1.x
    down: sensor.swpoe1_sfp1_in_rate     # parent → child (child's IN)
    up: sensor.swpoe1_sfp1_out_rate      # child → parent (child's OUT)
    status: sensor.swpoe1_sfp1_status    # 1 = up, 2 = down
switches:
  - name: SG2210P-1
    model: SG2210P
    ip: 192.168.1.x
```

---

## 🖥️ Compatibility

| | |
|---|---|
| Home Assistant | 2024.6+ |
| Lovelace | Default & custom dashboards |
| Devices | Mobile & Desktop |
| Dependencies | None extra; data from SNMP Switch Manager or SNMP sensors |
| Browsers | Chrome, Firefox, Safari, Edge (recent) |
| Account | Administrator |
| Offline | Uses Home Assistant's own UI libraries; only falls back to a CDN (jsDelivr) when the HA build does not provide them |

---

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| `snmpwalk` times out | Community not applied/saved, SNMP is off, or the ACL does not allow the HA IP |
| Integration errors after changing the community | Set **SNMP Community Override**, or delete and re-add |
| Weak switch keeps timing out in the integration | Use YAML sensors and declare a manual switch |
| Include rule yields no sensors | Value must match the name in Controls; try Match **Contains** |
| Throughput shows `Unknown` | Wait 1–2 minutes, two reads are needed |
| *"No switch found from the SNMP Switch Manager integration"* | Check the integration is loaded; `core.switch` and `links` must use the **exact device name** in HA |
| *"Cannot read the HA registry"* | Open the dashboard with an **Administrator** account |
| Port shows as `1/0/3` and ignores custom names | Keep the `switch.*` port entities **enabled** (Hide, not Disable), then reload the card |
| One switch appears as two nodes | Remove it from `switches:` and point `links` at the integration's device name |
| Link shows `–` or no speed | Enable **Bandwidth Collection** with *Sensors (history)* and a matching include rule, wait a few minutes |
| `↓ ↑` reversed | Set `swap_rx_tx: true` |
| ISP/pfSense node has no second line | Line 2 only shows the IP: set `isp.ip`, `pfsense.ip`; ping, CPU and RAM are in the tooltip |
| Flow lines show through text | Raise `node_opacity` (for example `90`) |
| Layout not saved | Only drag in arrange mode `✥` and press **✓**; cards sharing a title need distinct `layout_id` values |
| Pinned column is off-screen | Use *Fit*, zoom out, or enter arrange mode and drag it back |
| Update not showing | Change `?v=` in the resource URL and hard-reload (`Ctrl+Shift+R`) |

---

## 📋 Changelog

### v1.0.0: first release
- 🌳 Tree diagram ISP → pfSense → core switch → switches → ports with devices, horizontal or vertical, animated flow lines driven by real bandwidth
- ✋ Drag every node (switches included), pin device columns, independent core switch column, flow lines entering ports from the side, layout saved per HA user
- 🎨 Glass/Neon styles, `node_opacity`, zoom, fullscreen, port search, Speedtest tile in the header
- 🔌 Smart ports: names from port descriptions, `port_names`, hide switches/ports, `isp.ip` and `pfsense.ip` show IPs on line 2
- 🔔 Yellow/red traffic glow alerts, auto-rotate through switches
- 🧱 Support for weak switches that cannot run through the integration, using YAML SNMP sensors (manual switches)
- 🎛️ Visual editor, no mandatory YAML

---

## 📄 License

MIT License: free to use, modify and distribute. If you find it useful, please ⭐ **star the repo**!

## 🙏 Credits

Designed and developed by **[@doanlong1412](https://github.com/doanlong1412)** from 🇻🇳 Vietnam.

Built on the excellent **[SNMP Switch Manager](https://github.com/OtisPresley/snmp-switch-manager)** integration by [@OtisPresley](https://github.com/OtisPresley).
