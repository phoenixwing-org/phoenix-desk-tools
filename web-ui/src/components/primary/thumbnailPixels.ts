/** An exactly uniform composite contains no visible preview content. */
export function isBlankThumbnail(pixels: Uint8ClampedArray): boolean {
  if (!pixels.length || pixels.length % 4) return false;
  const rgb = (offset: number, channel: number) => pixels[offset + channel] * pixels[offset + 3] + 255 * (255 - pixels[offset + 3]);
  for (let offset = 4; offset < pixels.length; offset += 4) for (let channel = 0; channel < 3; channel++) {
    if (rgb(offset, channel) !== rgb(0, channel)) return false;
  }
  return true;
}
