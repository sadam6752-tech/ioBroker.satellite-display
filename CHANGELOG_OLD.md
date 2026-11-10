# Older changes

Versions that no longer fit into the changelog of the [README](README.md) (it keeps the last five) are moved here.

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
