![Logo](admin/satellite-display.png)

# ioBroker.satellite-display

[![NPM version](https://img.shields.io/npm/v/iobroker.satellite-display.svg)](https://www.npmjs.com/package/iobroker.satellite-display)
[![Downloads](https://img.shields.io/npm/dm/iobroker.satellite-display.svg)](https://www.npmjs.com/package/iobroker.satellite-display)
[![License](https://img.shields.io/github/license/sadam6752-tech/ioBroker.satellite-display.svg)](LICENSE)

[![NPM](https://nodei.co/npm/iobroker.satellite-display.png?downloads=true)](https://nodei.co/npm/iobroker.satellite-display/)

![Test and Release](https://github.com/sadam6752-tech/ioBroker.satellite-display/workflows/Test%20and%20Release/badge.svg)

Tile pages on the touch display of ESPHome voice satellites, filled from ioBroker: values, gauges, charts,
switches, dimmers and buttons, each bound to a state. A touch on a switch, a dimmer or a button writes the state.

It is made for the [Waveshare ESP32-S3-AUDIO voice satellite](https://github.com/sadam6752-tech/esphome-waveshare-esp32-s3-audio-va)
with the [Waveshare 2.8inch Capacitive Touch LCD](https://www.waveshare.com/wiki/2.8inch_Capacitive_Touch_LCD)
(firmware **2.0.0** or newer). The voice of the satellite stays with
[ioBroker.assistant](https://github.com/ioBroker/ioBroker.assistant): this adapter opens its own connection to the
ESPHome Native API next to it and only handles the display.

```
ioBroker states  ──▶  satellite-display  ──▶  satellite (tile pages)
       ▲                                           │
       └──────────────  a touch on a tile  ◀───────┘
```

## Tiles

Each satellite has up to **4 pages**. A page is a grid of 2 columns × 4 rows on the 320 × 240 screen and holds up
to 8 tiles. Swipe left from the clock to reach them; a page without tiles is skipped.

| Size | Cells | Pixels |
| --- | --- | --- |
| small | 1 × 1 | 151 × 52 |
| square | 1 × 2 | 151 × 111 |
| wide | 2 × 1 | 308 × 52 |
| large | 2 × 2 | 308 × 111 |

| Kind | Shows | Sizes | A touch |
| --- | --- | --- | --- |
| Value | name, number with unit, or a text | all | – |
| Gauge | name, arc from the scale start to its end, number | square, large | – |
| Value with bar | name, number, bar along the scale | square, wide, large | – |
| Value with chart | name, number, line of the last 60 values | wide, large | – |
| Switch | name, toggle; the tile lights up when on | small, square, wide | toggles the state |
| Dimmer | name, toggle, slider, percent | wide, large | toggle and slider write the states |
| Button | icon, name | small, square, wide | writes `true` to the state |
| Thermostat | name, arc with the current temperature, − target +, a dot for the heating relay | square, large | − and + write the target |

## Settings

1. **Satellites:** name (room), IP address and API port (6053) of each satellite. An API encryption key is only needed
   when you built the firmware with one; the ready-made firmware has none.
2. **Tiles:** a graphical editor. Choose the satellite and the page; the preview shows the screen with the current
   values. Click a free cell to add a tile, drag a tile to move it, click a tile to edit it on the right: kind,
   size, the state (with the object browser of the admin), name, unit, icon and scale. Name, unit and scale may stay
   empty: they come from the object of the state. A tile beyond the eight a page takes is marked red.
3. **Charts (optional):** a history adapter (history, sql, influxdb). A chart then starts with the last hours of its
   state instead of empty.

Details of the kinds:

- **Switch:** reads the state as on/off (`true`, a number other than 0, `"on"` …) and writes the type of the state
  (`true`/`false`, `1`/`0`).
- **Dimmer:** the state is the level, 0-100 or the range of its object (`min`/`max`, e.g. 0-1 or 0-255); the slider
  writes the level when it is released. The second state is its on/off. Without a second state a level of 0 is off,
  and switching on restores the last level.
- **Button:** writes `true` (or `1` for a number state), e.g. to a scene or a script trigger.
- **Thermostat:** three states: the current temperature (the arc), the target temperature (written by − and +)
  and, optional, the heating relay (the dot: green on, grey off). − and + change the target on the screen at
  once by the step (0.5 unless set); one second after the last press the adapter writes it. The scale and the
  limits of the target come from the object of the target temperature (`min`/`max`), else 5-30. Needs the
  satellite firmware **2.0.1**; an older firmware is reported in the log and the tile is left out.
- A value that is no number (text, `true`/`false`) shows as text on a value tile.

The toggle and the slider change at once on the screen. When the device does not follow, the tile shows the real
state again after three seconds.

## States

| State | Meaning |
| --- | --- |
| `info.connection` | all satellites are connected and have their tiles |
| `satellites.<name>.connected` | this satellite is connected and has its tiles |
| `satellites.<name>.lastTouch` | the last touch on a tile, as JSON (`page`, `slot`, `input`, `value`, `ts`) |
| `satellites.<name>.resend` | button: sends all tiles again |

The satellite keeps no layout: after a restart or a lost connection the adapter sends all tiles and their values
again by itself.

## Notes

- The satellite firmware must be **2.0.0** or newer; an older firmware is reported in the log ("tile pages need the
  satellite firmware 2.0.0").
- The format between adapter and firmware is described in
  [docs/TILES.md of the firmware](https://github.com/sadam6752-tech/esphome-waveshare-esp32-s3-audio-va/blob/main/docs/TILES.md).
- The icons are a fixed set built into the firmware; the settings offer exactly that list.

## Changelog

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### 0.0.2 (2026-11-09)

- Thermostat tile: current temperature in an arc, the target temperature with − and +, a dot for the heating
  relay (satellite firmware 2.0.1)
- Released through GitHub Actions with provenance

### 0.0.1 (2026-11-09)

- First version: tile pages on the touch display of ESPHome voice satellites, with a graphical tile editor

## License

MIT License

Copyright (c) 2026 sadam6752-tech <sadam6752@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
