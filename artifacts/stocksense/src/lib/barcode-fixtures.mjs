// Synthetic, deterministic labels for decoder and browser tests; not demo product records.
import library from '@zxing/library';

function render(modules) {
  const scale = 3, quiet = 18, width = (modules.length + quiet * 2) * scale, height = 160;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  let rectangles = '';
  modules.forEach((bar, index) => {
    if (!bar) return;
    const x = (index + quiet) * scale;
    rectangles += `<rect x="${x}" y="20" width="${scale}" height="120"/>`;
    for (let y = 20; y < 140; y++) pixels.fill(0, y * width + x, y * width + x + scale);
  });
  return { width, height, pixels, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g fill="black">${rectangles}</g></svg>` };
}

export const code128Value = '001234560099';
const data = [0, 12, 34, 56, 0, 99];
const codes = [105, ...data, (105 + data.reduce((total, code, index) => total + code * (index + 1), 0)) % 103, 106];
export const code128Fixture = render(codes.flatMap(code => [...library.Code128Reader.CODE_PATTERNS[code]].flatMap((width, index) => Array(width).fill(index % 2 === 0))));

export const ean13Value = '5901234123457';
const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const odd = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const digits = ean13Value.split('').map(Number);
const bars = '101' + digits.slice(1, 7).map((digit, index) => (parity[digits[0]][index] === 'L' ? left : odd)[digit]).join('')
  + '01010' + digits.slice(7).map(digit => left[digit].replace(/[01]/g, bit => bit === '0' ? '1' : '0')).join('') + '101';
export const ean13Fixture = render(bars.split('').map(bit => bit === '1'));