# Older changes

Versions that no longer fit into the changelog of the [README](README.md) (it keeps the last five) are moved here.

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

### 0.1.1 (2026-11-10)

- The tile panel without voice (Waveshare ESP32-S3-Touch-LCD-2, `panel-lcd2.yaml` of the firmware) works as a
  satellite; its state `satellites.<name>.brightness` sets the brightness of the display (0 = dark)
- A display with a player (the panel with a MAX98357A amplifier) gets `satellites.<name>.media.*`: a stream URL to
  play (e.g. from an AirPlay receiver), volume, stop and its state

### 0.1.0 (2026-11-10)

- Screen lock with a PIN per satellite (tab Satellites): the display shows only the clock and a lock, the wake word is
  ignored, a touch opens a keypad; the satellite checks the PIN itself (satellite firmware 2.1.0)
- Tab Authentication: lock again after some minutes without a touch, when the display goes back to the clock, or only
  by hand; the state `satellites.<name>.locked` locks and unlocks from ioBroker

### 0.0.8 (2026-11-10)

- Colours: a default main colour of the tiles (tab Appearance), an own main colour and background per tile, and a
  background from another state (on = a chosen colour, or a colour `#RRGGBB` written into the state)
- Icons on the small, wide and large tiles of every kind, "only the icon" instead of the name; a small or wide
  switch with an icon and a name becomes a tile switch without the toggle (satellite firmware 2.0.4)

### 0.0.7 (2026-11-09)

- Thresholds: "Red below" / "Red above" turn the value and its arc, bar or line red beyond a value (satellite
  firmware 2.0.3)

### 0.0.6 (2026-11-09)

- Tile editor: "Show on the satellite" sends the tiles as they are in the editor to the satellite, without saving
  (back to the saved tiles with "End preview", after saving, or after 10 minutes)
- The chart preview draws the real history of the state when a history adapter is set
- A value tile shows the text that `common.states` of the object gives the value (e.g. 1 → "Heizen")
- The editor warns about a state that does not exist, a read-only state on a switch, and a number tile on a state
  that is no number

### 0.0.5 (2026-11-09)

- Tile editor: "Copy page" copies the visible page to another page or another satellite (the tiles there are
  replaced)
- The icons are shown in the list and in the preview
- Undo with Ctrl+Z or the undo button (the last 50 changes)

### 0.0.4 (2026-11-09)

- Tile editor: drag a tile onto another one to swap the two (the target shows blue when they fit, red when not)
- A chosen state fills the name and the unit of the tile from its object, unless you wrote your own
- "Duplicate tile" puts a copy on the first free place of the page (or of the next pages)

### 0.0.3 (2026-11-09)

- Small bar and chart tiles (1 × 1): the name and the value on one line, the bar or the line below (satellite
  firmware 2.0.2)
- The tile editor marks a tile the adapter would leave out, with the reason

### 0.0.2 (2026-11-09)

- Thermostat tile: current temperature in an arc, the target temperature with − and +, a dot for the heating
  relay (satellite firmware 2.0.1)
- Released through GitHub Actions with provenance

### 0.0.1 (2026-11-09)

- First version: tile pages on the touch display of ESPHome voice satellites, with a graphical tile editor
