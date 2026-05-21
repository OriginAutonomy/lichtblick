// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Origin semantic segmentation 28-class color palette (eomt_semantic_fp16.trt).
// R channel of rgba8 image = class ID. This LUT maps class ID → display color.

// [R, G, B, A] per class, 28 entries
// prettier-ignore
export const SEMANTIC_LUT = new Uint8Array([
   31, 119, 180, 255,  //  0: Drywall
  174, 199, 232, 255,  //  1: Ceiling Drywall
  255, 127,  14, 255,  //  2: Floor
  255, 187, 120, 255,  //  3: Compounded Vertical Screws
   44, 160,  44, 255,  //  4: Compounded Circular Screws
  152, 223, 138, 255,  //  5: Ceiling Vertical Screws
  214,  39,  40, 255,  //  6: Ceiling Circular Screws
  255, 152, 150, 255,  //  7: L2 Vertical Seam
  148, 103, 189, 255,  //  8: L2 Horizontal Seam
  197, 176, 213, 255,  //  9: L2 Edge Horizontal Seam
  140,  86,  75, 255,  // 10: L2 Edge Vertical Seam
  196, 156, 148, 255,  // 11: L4 Vertical Seam
  227, 119, 194, 255,  // 12: L4 Horizontal Seam
  247, 182, 210, 255,  // 13: L4 Edge Horizontal Seam
  127, 127, 127, 255,  // 14: L4 Edge Vertical Seam
  199, 199, 199, 255,  // 15: Ceiling L2 Seam
  188, 189,  34, 255,  // 16: Ceiling L4 Seam
  219, 219, 141, 255,  // 17: Electrical Outlet
   23, 190, 207, 255,  // 18: L4 Electrical Cutout
  158, 218, 229, 255,  // 19: Ceiling Electrical Outlet
  216, 140,   0, 255,  // 20: L5 Sprayed
    0, 153, 127, 255,  // 21: L5 Ceiling
  140,   0, 140, 255,  // 22: Frame for Window
  242, 242,   0, 255,  // 23: Frame for Door
    0,   0, 140, 255,  // 24: Outlier
  140,  76,   0, 255,  // 25: Robot
    0, 102,   0, 255,  // 26: Person
    0,   0,   0, 255,  // 27: Background
]);

export const SEMANTIC_CLASS_NAMES: readonly string[] = [
  "Drywall",
  "Ceiling Drywall",
  "Floor",
  "Compounded Vertical Screws",
  "Compounded Circular Screws",
  "Ceiling Vertical Screws",
  "Ceiling Circular Screws",
  "L2 Vertical Seam",
  "L2 Horizontal Seam",
  "L2 Edge Horizontal Seam",
  "L2 Edge Vertical Seam",
  "L4 Vertical Seam",
  "L4 Horizontal Seam",
  "L4 Edge Horizontal Seam",
  "L4 Edge Vertical Seam",
  "Ceiling L2 Seam",
  "Ceiling L4 Seam",
  "Electrical Outlet",
  "L4 Electrical Cutout",
  "Ceiling Electrical Outlet",
  "L5 Sprayed",
  "L5 Ceiling",
  "Frame for Window",
  "Frame for Door",
  "Outlier",
  "Robot",
  "Person",
  "Background",
];

const NUM_CLASSES = 28;

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
