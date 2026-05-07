// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Isaac ROS / Nvblox semantic segmentation 26-class color palette.
// R channel of rgba8 image = class ID. This LUT maps class ID → display color.
// Source: nvblox semantic_segmentation.yaml

// [R, G, B, A] per class, 26 entries
// prettier-ignore
export const SEMANTIC_LUT = new Uint8Array([
    0,   0,   0, 255,  //  0: Unlabeled
   70,  70,  70, 255,  //  1: Building
  190, 153, 153, 255,  //  2: Fences
   72,   0,  90, 255,  //  3: Other
  220,  20,  60, 255,  //  4: Pedestrian
  153, 153, 153, 255,  //  5: Pole
  157, 234,  50, 255,  //  6: Road Line
  128,  64, 128, 255,  //  7: Road
  244,  35, 232, 255,  //  8: Sidewalk
  107, 142,  35, 255,  //  9: Vegetation
    0,   0, 255, 255,  // 10: Car
  102, 102, 156, 255,  // 11: Wall
  220, 220,   0, 255,  // 12: Traffic Sign
   70, 130, 180, 255,  // 13: Sky
    0,   0,  70, 255,  // 14: Ground
  150, 100, 100, 255,  // 15: Bridge
  230, 150, 140, 255,  // 16: Rail Track
  180, 165, 180, 255,  // 17: Guard Rail
    0,  60, 100, 255,  // 18: Traffic Light
  110,  70,  80, 255,  // 19: Static
   81,   0,  81, 255,  // 20: Dynamic
  111,  74,   0, 255,  // 21: Water
  250, 170, 160, 255,  // 22: Terrain
  230, 150, 140, 255,  // 23: Person on Bike/Cycle
   50, 120, 170, 255,  // 24: Truck
  180,   0,   0, 255,  // 25: Bus
]);

export const SEMANTIC_CLASS_NAMES: readonly string[] = [
  "Unlabeled",
  "Building",
  "Fences",
  "Other",
  "Pedestrian",
  "Pole",
  "Road Line",
  "Road",
  "Sidewalk",
  "Vegetation",
  "Car",
  "Wall",
  "Traffic Sign",
  "Sky",
  "Ground",
  "Bridge",
  "Rail Track",
  "Guard Rail",
  "Traffic Light",
  "Static",
  "Dynamic",
  "Water",
  "Terrain",
  "Person on Bike/Cycle",
  "Truck",
  "Bus",
];

const NUM_CLASSES = 26;

export function colorizeSemanticImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const classId = data[offset]!; // R channel = class ID
    const lutOffset = (classId < NUM_CLASSES ? classId : 0) * 4;
    data[offset] = SEMANTIC_LUT[lutOffset]!;
    data[offset + 1] = SEMANTIC_LUT[lutOffset + 1]!;
    data[offset + 2] = SEMANTIC_LUT[lutOffset + 2]!;
    data[offset + 3] = SEMANTIC_LUT[lutOffset + 3]!;
  }
}
