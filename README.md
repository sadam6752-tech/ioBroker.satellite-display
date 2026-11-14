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

A display without voice works too: the firmware repository has `panel-lcd2.yaml` for the
[Waveshare ESP32-S3-Touch-LCD-2](https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-2), a 2 inch tile panel with the
same tile pages and screen lock. Add it like a satellite (IP address, port 6053).

```
ioBroker states  ──▶  satellite-display  ──▶  satellite (tile pages)
       ▲                                           │
       └──────────────  a touch on a tile  ◀───────┘
```

## Tiles

Each satellite has up to **4 pages**. A page is a grid of 2 columns × 4 rows on the 320 × 240 screen and holds up
to 8 tiles. Swipe left from the clock to reach them; a page without tiles is skipped.

| Size   | Cells | Pixels    |
| ------ | ----- | --------- |
| small  | 1 × 1 | 151 × 52  |
| square | 1 × 2 | 151 × 111 |
| wide   | 2 × 1 | 308 × 52  |
| large  | 2 × 2 | 308 × 111 |

| Kind             | Shows                                                                           | Sizes               | A touch                            |
| ---------------- | ------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
| Value            | name, number with unit, or a text                                               | all                 | –                                  |
| Gauge            | name, arc from the scale start to its end, number                               | square, large       | –                                  |
| Value with bar   | name, number, bar along the scale                                               | all                 | –                                  |
| Value with chart | name, number, line of the last 60 values                                        | small, wide, large  | –                                  |
| Switch           | name, toggle; the tile lights up when on                                        | small, square, wide | toggles the state                  |
| Dimmer           | name, toggle, slider, percent                                                   | wide, large         | toggle and slider write the states |
| Button           | icon, name                                                                      | small, square, wide | writes `true` to the state         |
| Thermostat       | name, arc with the current temperature, − target +, a dot for the heating relay | square, large       | − and + write the target           |

## Settings

1. **Satellites:** name (room), IP address and API port (6053) of each satellite. An API encryption key is only needed
   when you built the firmware with one; the ready-made firmware has none.
2. **Tiles:** a graphical editor. Choose the satellite and the page; the preview shows the screen with the current
   values. Click a free cell to add a tile, drag a tile to a free cell to move it or onto another tile to swap the
   two, click a tile to edit it on the right: kind, size, the state (with the object browser of the admin), name,
   unit, icon and scale. Choosing a state fills in its name and unit; you can change them. Name, unit and scale may
   also stay empty: they come from the object of the state. "Copy page" copies the page to another page or
   satellite, Ctrl+Z undoes the last changes. "Show on the satellite" puts the tiles of the editor on the satellite
   without saving, to try sizes and places (the instance must run). A tile the adapter would leave out is marked red, with the reason (a
   size its kind does not come in, a thermostat without its target, more than eight tiles on a page).
3. **Charts (optional):** a history adapter (history, sql, influxdb). A chart then starts with the last hours of its
   state instead of empty.

Details of the kinds:

- **Switch:** reads the state as on/off (`true`, a number other than 0, `"on"` …) and writes the type of the state
  (`true`/`false`, `1`/`0`).
- **Dimmer:** the state is the level, 0-100 or the range of its object (`min`/`max`, e.g. 0-1 or 0-255); the slider
  writes the level when it is released. The second state is its on/off. Without a second state a level of 0 is off,
  and switching on restores the last level.
- **Button:** writes `true` (or `1` for a number state), e.g. to a scene or a script trigger.
- **Colours:** the tab **Appearance** sets the main colour of all tiles (value, arc, bar, line, toggles); a tile can
  have its own main colour and background. A **background state** colours the tile from another state: while it is
  on (`true`, a number other than 0) the tile takes the chosen colour; a state that holds a colour (`#7F1D1D`) gives
  that colour, e.g. from a script. A threshold still turns the tile red. Needs the satellite firmware **2.0.4** for
  the background (the main colour works from 2.0.3).
- **Icons:** every kind can show an icon. A small (1 × 1) or wide tile shows it left in the middle, a large one top
  left; the square tiles (1 × 2) keep their layout. "Only the icon" puts it in the place of the name. A small or wide
  switch with an icon and a name has no toggle: the whole tile is the switch and lights up when on; with only the
  icon it keeps the toggle. "The whole tile switches" sets this for every switch, the square one too. Needs the
  satellite firmware **2.0.4**.
- **Thresholds:** value, gauge, bar, chart and thermostat tiles have "Red below" and "Red above": beyond them the
  value and its arc, bar or line turn red, e.g. a battery below 20 %. Needs the satellite firmware **2.0.3**; an older
  one keeps the colours.
- **Thermostat:** three states: the current temperature (the arc), the target temperature (written by − and +)
  and, optional, the heating relay (the dot: green on, grey off). − and + change the target on the screen at
  once by the step (0.5 unless set); one second after the last press the adapter writes it. The scale and the
  limits of the target come from the object of the target temperature (`min`/`max`), else 5-30. Needs the
  satellite firmware **2.0.1**; an older firmware is reported in the log and the tile is left out.
- A value that is no number (text, `true`/`false`) shows as text on a value tile. When the object of the state has
  `common.states` (e.g. `0: Aus, 1: Heizen, 2: Kühlen`), the value tile shows that text instead of the number.

The toggle and the slider change at once on the screen. When the device does not follow, the tile shows the real
state again after three seconds.

## Screen lock

A satellite can be locked with a PIN of 4 to 6 digits (tab **Satellites**: "Screen lock" and "PIN"). While it is
locked the display shows only the clock and the date and a lock instead of the gear; the pages of tiles, the system
page and the settings cannot be reached, and the satellite does not react to the wake word. Announcements, alarms,
timers and music still sound. A touch opens a keypad; the PIN is checked as soon as all digits are typed. After 5
wrong PINs in a row the keypad waits a minute; without a key it closes after 30 seconds.

The tab **Authentication** decides when an unlocked satellite locks again: after some minutes without a touch, when
the display goes back to the clock by itself, or only by hand. The open lock next to the gear locks at once in every
mode. The state `satellites.<name>.locked` shows the lock and locks or unlocks from ioBroker (e.g. at night or with
the alarm system); `satellites.<name>.failedPins` counts the wrong PINs.

The PIN does not leave ioBroker: the satellite gets its SHA-256 hash and keeps it in its flash, so the lock also
works after a restart and without ioBroker. Needs the satellite firmware **2.1.0**.

**Tablets** (tab **Tablets**: "Screen lock" and "PIN") lock the same way and follow the same tab **Authentication**:
"when the display goes back to the clock" is the moment their clock page comes (a minute without a touch when the
clock is off), and the lock in their bar locks at once. A locked tablet with the clock page shows the clock first and
the keypad after a touch. Their states are `tablets.<name>.locked` and `tablets.<name>.failedPins`. A tablet checks
the PIN in its browser: that keeps children and guests out, but it does not stop someone who knows the developer tools
of a browser (a satellite checks the PIN in its firmware).

## Tablets (web app, off by default)

An Android or iOS tablet can show tiles like a satellite without voice: the adapter serves a web app (PWA) and the
tablet keeps a connection to it. Nothing of this runs until it is switched on: without the checkbox the adapter opens
no port and creates no objects for tablets.

1. Tab **Tablets**: switch on "Tablets with the web app (PWA)", choose the port (default 8094) and enter a row per
   tablet: its screen size in pixels (e.g. an iPad 2048 x 1536 in landscape, 1536 x 2048 upright: the tile editor
   draws the tablet in that shape) and its grid, columns x rows of a page and the number of pages (a 10" tablet in
   landscape: 4 x 3).
2. Save, then press "Show links and QR codes": each tablet has its own link with an access key, as text and as a
   QR code.
3. Point the camera of the tablet at its code (or open the link there) and add the page to the home screen. It starts full screen, keeps the screen on (where
   the browser allows it) and connects again by itself after the tablet was asleep.

A tile names its tablet in the field "satellite" like a satellite; the commands for an AI agent (below) place tiles on
a tablet the same way, and `getTiles` names the grid of every display. The screen lock with a PIN (tab **Tablets**,
"Screen lock") works as on a satellite; the tablet checks the PIN itself.

- **HTTPS**: a browser installs the web app and keeps the screen on only from a secure origin, on iOS always. Switch
  on "Use HTTPS" and choose a certificate of the ioBroker collection (Admin > Settings > Certificates), the same pair
  the web adapter uses. When HTTPS is on and the certificate cannot be loaded, the web app stays off (it does not fall
  back to plain HTTP). Without HTTPS the page still works in a browser or a kiosk app, without installing it.
- **iOS** closes the connection when the screen goes dark; the page connects again when it is shown. For a panel on
  the wall use Guided Access and keep the display on in the settings of the iPad.
- The **access key** is kept in the object `tablets.<name>` and stays the same across restarts. Who knows the link
  can see and switch the tiles of that tablet, nothing else. Remove the row of the tablet (or switch the web app off)
  to make its link invalid; a new row gets a new key, and a tablet with an old link says that its link is out of date.
  "New link" on the card of a tablet gives it a new key at once (when the link got into wrong hands or the tablet is
  given away): the old link stops working, also on the home screen of the tablet.
- **Renaming** a tablet or a satellite in the settings keeps it the same device: at the next start the adapter finds
  that one name is gone and one is new, gives the tablet its old access key (its link keeps working) and moves the
  tiles to the new name. When more than one device of a kind changed at once, the tile editor shows the tiles of an
  old name with "Move to ..." and "Delete these tiles".
- The port is declared in the registry of used resources of js-controller 8, so the admin can show it as taken.
- The tile editor of the admin shows the tablets next to the satellites, on the grid of each.
- **Clock when idle** (tab **Tablets**, off by default): after the set minutes without a touch the tablets show the
  time and the date, as a satellite shows its clock. A touch shows the keypad of the screen lock, or the tiles when the
  tablet is not locked. With the lock mode "when the display goes back to the clock" the tablet locks when its clock
  comes.
- **Page titles**: a page of a tablet can have a title (e.g. "Heizung"), set in the tile editor next to the page
  buttons or by an AI agent (`setPageTitle`). The bar of the tablet shows it next to the name of the tablet while that
  page is shown; the keypad of the screen lock shows only the name. Satellites have no place for it.

## Commands (e.g. for an AI agent)

The tiles can also be changed with `sendTo('satellite-display.0', command, message)`, e.g. by ioBroker.pi-agent
("add a narrow switch for the light in the living room to the display of Gast"). The answers are short JSON; an error
names what to ask the user (which satellite, which page when all are full).

| Command        | Message                                                                                      | Does                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `help`         | –                                                                                            | describes the commands, kinds, sizes, icons and the grid                                     |
| `getTiles`     | `{satellite?}`                                                                               | lists the satellites and tablets, their grids, their tiles (with an `id`) and the free cells |
| `addTile`      | `{satellite, type, state, size?, icon?, label?, unit?, state2?, state3?, page?, col?, row?}` | adds a tile, without a place in the first free cell; answers where it went                   |
| `updateTile`   | `{id, ...fields}`                                                                            | changes a tile                                                                               |
| `moveTile`     | `{id, page, col?, row?}`                                                                     | moves a tile, without `col`/`row` to the first free cell of the page                         |
| `removeTile`   | `{id}`                                                                                       | removes a tile                                                                               |
| `setPageTitle` | `{satellite, page, title}`                                                                   | the title of a page of a tablet, shown in its bar; empty removes it                          |

A change is saved in the settings of the instance, which then restarts and sends the tiles (a few seconds). In
ioBroker.pi-agent the instance needs "Write allowed" in the write permissions.

## States

| State                                                           | Meaning                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `info.connection`                                               | all satellites are connected and have their tiles (with tablets only: the web app runs)                     |
| `satellites.<name>.connected`                                   | this satellite is connected and has its tiles (role `indicator.reachable`)                                  |
| `satellites.<name>.lastTouch`                                   | the last touch on a tile, as JSON (`page`, `slot`, `input`, `value`, `ts`)                                  |
| `satellites.<name>.resend`                                      | button: sends all tiles again                                                                               |
| `satellites.<name>.locked`                                      | the screen is locked; write `true` / `false` to lock or unlock (only with a screen lock)                    |
| `satellites.<name>.failedPins`                                  | wrong PINs in a row on the display (only with a screen lock)                                                |
| `satellites.<name>.media.url`                                   | play this stream URL (only displays with a player, e.g. the tile panel with an I2S amplifier); empty = stop |
| `satellites.<name>.media.volume`                                | volume 0-100 %                                                                                              |
| `satellites.<name>.media.title`                                 | title shown in the bar of the clock while it plays (e.g. the station)                                       |
| `satellites.<name>.media.stop`                                  | button: stop playing                                                                                        |
| `satellites.<name>.media.state`                                 | `play` (also while it announces), `pause` or `stop`                                                         |
| `satellites.<name>.brightness`                                  | brightness of the display 0-100 %, 0 = dark (only displays that take it from ioBroker, e.g. the tile panel) |
| `tablets.<name>.connected`                                      | this tablet is connected and has its tiles (a sleeping tablet is not)                                       |
| `tablets.<name>.lastTouch`, `.resend`, `.locked`, `.failedPins` | as for a satellite                                                                                          |

The satellite keeps no layout: after a restart or a lost connection the adapter sends all tiles and their values
again by itself.

## Notes

- The small bar and chart tiles (1 × 1) need the satellite firmware **2.0.2**; an older one leaves them empty and
  writes a warning into its own log.
- The satellite firmware must be **2.0.0** or newer; an older firmware is reported in the log ("tile pages need the
  satellite firmware 2.0.0").
- The format between adapter and firmware is described in
  [docs/TILES.md of the firmware](https://github.com/sadam6752-tech/esphome-waveshare-esp32-s3-audio-va/blob/main/docs/TILES.md).
- The icons are a fixed set built into the firmware; the settings offer exactly that list.
- The web app of the tablets draws the same icons from [Material Design Icons](https://pictogrammers.com) 7.4.47
  (Apache License 2.0), generated into `www/icons.js` by `tools/build-icons.js`.
- After an update of the adapter, reload the admin page (F5) once: an open admin keeps the old tile editor in memory.

## Changelog

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### 0.3.1 (2026-11-14)

- (sadam6752-tech) Tablets can show a clock with the date when idle (tab Tablets: on/off and the minutes); a touch
  shows the keypad of the screen lock or the tiles
- (sadam6752-tech) Tab Authentication and the README describe the screen lock of the tablets
- (sadam6752-tech) The tile editor draws a tablet as the tablet shows it: the sizes in CSS pixels of its screen with
  the limits of the web app, the decimals of the adapter, a boolean as 1/0 on tiles that show numbers

### 0.3.0 (2026-11-14)

- (sadam6752-tech) Tablets with a web app (PWA), off by default: an Android or iOS tablet shows tiles like a satellite
  on a grid of its own size; the AI agent commands place tiles on it too. The adapter serves the app on its own port
  (HTTPS with a certificate of ioBroker) and declares the port in the used resources registry of js-controller 8
- (sadam6752-tech) A satellite or tablet renamed in the settings keeps its tiles, and a tablet its link; the tile
  editor offers to move or delete the tiles of a name that is gone
- (sadam6752-tech) Links of the tablets with QR codes and a "New link" button; a tablet keeps the icon and the toggle of
  a switch together, and takes every tile type in every size
- (sadam6752-tech) Page titles on tablets (e.g. "Heizung"), set in the tile editor or with the command `setPageTitle`

### 0.2.1 (2026-11-13)

- (sadam6752-tech) A tile shows a state of a device only once it is confirmed (`ack`), never a command the device did
  not carry out; states in `0_userdata.0` and of scripts show at once, since nobody confirms them
- (sadam6752-tech) `media.state` has the values of its role: `play`, `pause`, `stop` (was `playing`, `paused`,
  `announcing`, `idle`)
- (sadam6752-tech) `satellites.<name>.connected` has the role `indicator.reachable`; the tile editor needs admin 8.0.0
  or newer

### 0.2.0 (2026-11-11)

- Commands for AI agents such as ioBroker.pi-agent (sendTo): `help`, `getTiles`, `addTile`, `updateTile`, `moveTile`,
  `removeTile`; a tile without a place goes to the first free cell, and the answers say what to ask the user

### 0.1.2 (2026-11-10)

- `media.url` plays only an `http://` or `https://` address; an empty value or `stop` (as other players of ioBroker
  take it, e.g. ioBroker.spotify-connect) stops the player

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
