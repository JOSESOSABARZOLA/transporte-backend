/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: paleta-formularios.spec.ts
 * Responsabilidad: Que la paleta de formularios se lea y se distinga: contraste con el texto
 *   negro del chip y distancia perceptual entre colores.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * La distancia es CIEDE2000 (ΔE00): por debajo de ~10, dos pasteles se confunden en un chip
 * pequeño. Los catorce colores originales ya están guardados en formularios y no se cambian;
 * los pares de ellos que quedan cerca se listan aquí, explícitos, para que un color NUEVO que
 * se acerque demasiado a cualquier otro haga fallar la prueba.
 */
import { PALETA_FORMULARIOS, esColorDePaleta } from './paleta-formularios';

const DISTANCIA_MINIMA = 10;
const CONTRASTE_MINIMO = 7;
const ORIGINALES = 14;

/**
 * Pares de los catorce originales por debajo de la distancia mínima. Se conservan porque los
 * usan formularios guardados (`esColorDePaleta` exige coincidencia exacta). No agregar pares
 * nuevos aquí: un color nuevo debe distinguirse de todos.
 */
const PARES_ORIGINALES_CERCANOS = new Set([
  '#FCE5CD|#FCE4D6', // Naranja claro · Naranja fuerte
  '#FCE5CD|#FFF2CC', // Naranja claro · Amarillo claro
  '#FCE5CD|#F8CBAD', // Naranja claro · Durazno
  '#B4C6E7|#CCCCFF', // Azul · Morado
  '#D9D9D9|#DEEBF7', // Gris · Celeste
  '#D9D9D9|#E4DFEC', // Gris · Lavanda
  '#FFCCCC|#F4CCCC', // Rosado · Rojo claro
  '#FCE4D6|#F8CBAD', // Naranja fuerte · Durazno
  '#D9EAD3|#C6E0B4', // Verde pastel · Verde menta
  '#DEEBF7|#E4DFEC', // Celeste · Lavanda
]);

const aCanales = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const lineal = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function luminancia(hex: string): number {
  const [r, g, b] = aCanales(hex).map(lineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG del fondo con el texto negro (luminancia 0). */
const contrasteConNegro = (hex: string): number =>
  (luminancia(hex) + 0.05) / 0.05;

function aLab(hex: string): [number, number, number] {
  const [r, g, b] = aCanales(hex).map(lineal);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** ΔE CIEDE2000 entre dos colores hexadecimales. */
function distancia(a: string, b: string): number {
  const [L1, a1, b1] = aLab(a);
  const [L2, a2, b2] = aLab(b);
  const rad = Math.PI / 180;
  const cMedia = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMedia ** 7 / (cMedia ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const angulo = (y: number, x: number): number => {
    const h = Math.atan2(y, x) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = angulo(b1, ap1);
  const hp2 = angulo(b2, ap2);
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1;
  const dC = cp2 - cp1;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lMedia = (L1 + L2) / 2;
  const cpMedia = (cp1 + cp2) / 2;
  let hMedia = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hMedia += hMedia < 360 ? 360 : -360;
    hMedia /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hMedia - 30) * rad) +
    0.24 * Math.cos(2 * hMedia * rad) +
    0.32 * Math.cos((3 * hMedia + 6) * rad) -
    0.2 * Math.cos((4 * hMedia - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hMedia - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpMedia ** 7 / (cpMedia ** 7 + 25 ** 7));
  const sl =
    1 + (0.015 * (lMedia - 50) ** 2) / Math.sqrt(20 + (lMedia - 50) ** 2);
  const sc = 1 + 0.045 * cpMedia;
  const sh = 1 + 0.015 * cpMedia * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    (dL / sl) ** 2 +
      (dC / sc) ** 2 +
      (dH / sh) ** 2 +
      rt * (dC / sc) * (dH / sh),
  );
}

describe('PALETA_FORMULARIOS', () => {
  const fondos = PALETA_FORMULARIOS.map((c) => c.fondo.toUpperCase());

  it('tiene 24 colores con nombre y fondo únicos', () => {
    expect(PALETA_FORMULARIOS).toHaveLength(24);
    expect(new Set(PALETA_FORMULARIOS.map((c) => c.nombre)).size).toBe(24);
    expect(new Set(fondos).size).toBe(24);
    for (const color of PALETA_FORMULARIOS) {
      expect(color.fondo).toMatch(/^#[0-9A-F]{6}$/);
      expect(color.acento).toBe('#000000');
    }
  });

  it('conserva los catorce originales tal cual, porque los formularios guardados los usan', () => {
    expect(esColorDePaleta('#A2C4C9', '#000000', 'Verde azulado')).toBe(true);
    expect(esColorDePaleta('#FCE4D6', '#000000', 'Naranja fuerte')).toBe(true);
    expect(esColorDePaleta('#F8CBAD', '#000000', 'Durazno')).toBe(true);
  });

  it.each(PALETA_FORMULARIOS.map((c) => [c.nombre, c.fondo]))(
    '%s (%s) contrasta al menos 7:1 con el texto negro del chip',
    (_nombre, fondo) => {
      expect(contrasteConNegro(fondo)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    },
  );

  it('cada color nuevo se distingue de todos los demás (ΔE00 ≥ 10)', () => {
    const cercanos: string[] = [];
    for (let i = ORIGINALES; i < fondos.length; i++) {
      for (let j = 0; j < fondos.length; j++) {
        if (i === j) continue;
        const d = distancia(fondos[i], fondos[j]);
        if (d < DISTANCIA_MINIMA) {
          cercanos.push(`${fondos[i]}~${fondos[j]} (${d.toFixed(1)})`);
        }
      }
    }
    expect(cercanos).toEqual([]);
  });

  it('entre los originales solo quedan cerca los pares conocidos', () => {
    const cercanos: string[] = [];
    for (let i = 0; i < ORIGINALES; i++) {
      for (let j = i + 1; j < ORIGINALES; j++) {
        if (distancia(fondos[i], fondos[j]) < DISTANCIA_MINIMA) {
          cercanos.push(`${fondos[i]}|${fondos[j]}`);
        }
      }
    }
    expect(new Set(cercanos)).toEqual(PARES_ORIGINALES_CERCANOS);
  });
});
