---
readings:
  - 12.5
  - 14
  - 13.25
  - 15
crew:
  - Ana
  - Ben
  - Chidi
inspections:
  - 2026-09-01
  - 2026-10-15
  - 2026-12-01
signed_off:
  - true
  - false
  - true
impedance:
  - 3+4i
  - 1-2i
grid:
  - - 1
    - 2
    - 3
  - - 4
    - 5
    - 6
purchases:
  - item: Cabinets
    cost: 4200
    ordered: 2026-09-02
    paid: true
  - item: Countertop
    cost: 2650
    ordered: 2026-09-10
    paid: false
  - item: Tile
    cost: 880
    ordered: 2026-09-12
    paid: false
phases:
  - phase: Demolition
    days: 3
    crew:
      - Ana
      - Ben
    tasks:
      - task: Strip cabinets
        hours: 6
      - task: Haul debris
        hours: 4
  - phase: Install
    days: 8
    crew:
      - Chidi
    tasks:
      - task: Hang cabinets
        hours: 20
---
# Property types

With the Solenoid plugin on, each property above shows as the chip Solenoid shows for that value, and clicking one opens the same editor. The note keeps plain YAML: a list is a sequence, a matrix a sequence of rows, a frame rows of `key: value`, and a cube rows whose values may themselves be lists or rows.
