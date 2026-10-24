// What a cover is, kept free of imports so the job table and the worker can share it.
/** 0.667 s at 30 fps: the frame the approved caching cover was taken from (hook complete, Pip's hop finished, no caption yet). */
export const COVER_FRAME = 20;
/** Bump when the way a cover is drawn changes: older covers then no longer match. */
export const COVER_VERSION = 1;
export const COVER_SIZE = {width: 1080, height: 1920};

export function pngSize(bytes: Buffer): {width: number; height: number} | null {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}
