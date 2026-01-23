export const STEP_COLORS = [
  '#FF5733', // Red-Orange
  '#33A1FF', // Blue
  '#33FF57', // Green
  '#FF33F6', // Magenta
  '#FFC300', // Yellow
  '#8E44AD', // Purple
  '#1ABC9C', // Teal
  '#E67E22', // Orange
];

export function getStepColor(index: number) {
  return STEP_COLORS[index % STEP_COLORS.length];
}
