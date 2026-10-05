/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: exportador-orden-memorando.spec.ts
 * Responsabilidad: Comprobar que el memorando se genera como un PDF válido con y sin operativos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-15
 */

import { PDFDocument } from 'pdf-lib';

import {
  APARTADOS_POR_DEFECTO,
  conNegrita,
  exportarOrdenMemorando,
  type DatosOrdenMemorando,
} from './exportador-orden-memorando';
import * as motor from './motor-documento';

// Los datos sin completar van VACÍOS (D14): el exportador los resalta como `[Etiqueta]`; ya no
// existe el centinela «XXXX». El número de orden vacío sale como placeholder gris, sin resaltar.
const DATOS: DatosOrdenMemorando = {
  numeroMemorando: '',
  ciudadFecha: 'Quito, D.M., 25 de junio de 2026',
  para: {
    nombre: 'DE LA GUERRA PORTUGAL LIDER FRANKLIN',
    cargo: 'Funcionario Directivo 9',
    dependencia: '',
  },
  numeroOrden: '',
  fechaEmision: '25/06/2026',
  direccionResponsable: 'Dirección Metropolitana de Inspección',
  telefonoFuncionario: '0987654321',
  operativos: [
    {
      identificador: 'IT-023-29-JUN-2026',
      horario: '08H00 A 16H30',
      zonal: 'Quitumbe',
      institucion: 'Empresa Pública Metropolitana de Agua Potable',
    },
    {
      identificador: 'IT-024-29-JUN-2026',
      horario: '08H00 A 16H30',
      zonal: 'Quitumbe',
      // Sin institución: la celda debe quedar en blanco (nunca «XXXX»).
      institucion: '',
    },
  ],
  firmante: { nombre: '', cargo: '', dependencia: '' },
  nut: '',
  elaboradoPor: '',
  siglasUnidad: '',
  apartados: APARTADOS_POR_DEFECTO,
};

describe('exportarOrdenMemorando', () => {
  it('genera un PDF válido', async () => {
    const buffer = await exportarOrdenMemorando(DATOS);

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('sin operativos no lanza y sigue produciendo el documento', async () => {
    const buffer = await exportarOrdenMemorando({ ...DATOS, operativos: [] });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('con número AMC-OS asignado y firmante completo (orden vigente) produce un PDF válido', async () => {
    // Ejercita las rutas sin faltantes: número de orden en firme (ASUNTO/título) y el bloque de
    // firma con «Firmado electrónicamente por:» + nombre/cargo/dependencia (sin resaltar, sin QR).
    const buffer = await exportarOrdenMemorando({
      ...DATOS,
      numeroOrden: 'AMC-OS-00005572-2026',
      numeroMemorando: 'AMC-DMI-2026-0123',
      para: {
        ...DATOS.para,
        dependencia: 'Dirección Metropolitana de Inspección',
      },
      firmante: {
        nombre: 'PEREZ JUAN',
        cargo: 'Director Metropolitano de Inspección',
        dependencia: 'Dirección Metropolitana de Inspección',
      },
      nut: 'NUT-0001',
      elaboradoPor: 'LOPEZ ANA',
      siglasUnidad: 'DMI',
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('un BORRADOR (E22) estampa la marca de agua y pesa más que el mismo documento sin ella', async () => {
    // La marca de agua se dibuja en CADA página, así que el PDF con marca es un documento válido y,
    // al añadir contenido en todas las hojas, mayor que el idéntico sin marca. (El texto va en el
    // flujo comprimido del PDF, así que no se puede buscar literalmente en el buffer.)
    const conMarca = await exportarOrdenMemorando({
      ...DATOS,
      esBorrador: true,
    });
    const sinMarca = await exportarOrdenMemorando({
      ...DATOS,
      esBorrador: false,
    });

    expect(conMarca.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(conMarca);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(conMarca.length).toBeGreaterThan(sinMarca.length);
  });

  it('sin esBorrador (orden Vigente) sale igual que con esBorrador:false (sin marca)', async () => {
    const porOmision = await exportarOrdenMemorando({
      ...DATOS,
      numeroOrden: 'AMC-OS-00005572-2026',
    });
    const explicitoFalse = await exportarOrdenMemorando({
      ...DATOS,
      numeroOrden: 'AMC-OS-00005572-2026',
      esBorrador: false,
    });

    expect(porOmision.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(porOmision.length).toBe(explicitoFalse.length);
  });

  it('la plantilla por defecto separa TÍTULO y ETIQUETA: el encabezado «APARTADO X» no lleva «· etiqueta»', () => {
    // H35: el encabezado del apartado (fila centrada) muestra SOLO «APARTADO X»; la etiqueta
    // («Fundamento legal y competencia»…) va aparte, en la columna izquierda de la tabla.
    for (const apartado of APARTADOS_POR_DEFECTO) {
      expect(apartado.titulo).not.toContain('·');
    }
    const porId = Object.fromEntries(
      APARTADOS_POR_DEFECTO.map((a) => [a.id, a]),
    );
    expect(porId.segundo.titulo).toBe('APARTADO SEGUNDO');
    expect(porId.segundo.etiqueta).toBe('Fundamento legal y competencia');
    expect(porId.tercero.etiqueta).toBe('Objeto de la orden de servicio');
    expect(porId.quinto.etiqueta).toBe('Disposiciones generales');
  });

  it('con teléfono del destinatario e institución del operativo produce un PDF válido (apartado cuarto)', async () => {
    // El apartado cuarto imprime Fecha · Zonal · Funcionario · Teléfono · Institución con datos
    // reales. El binario del PDF está comprimido (no se puede buscar el texto): se afirma que el
    // documento se genera sin lanzar con ambos datos presentes y con la institución vacía.
    const buffer = await exportarOrdenMemorando(DATOS);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('sin teléfono ni institución (campos opcionales ausentes) no lanza y produce el documento', async () => {
    // `telefonoFuncionario` ausente e `institucion` ausente: ambas columnas quedan en blanco.
    const sinTelefono: DatosOrdenMemorando = {
      ...DATOS,
      telefonoFuncionario: undefined,
      operativos: [
        { identificador: 'IT-100', horario: '08H00 A 16H30', zonal: 'DMQ' },
      ],
    };
    const buffer = await exportarOrdenMemorando(sinTelefono);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('un apartado CON etiqueta (columna izquierda) sigue produciendo un PDF válido', async () => {
    const buffer = await exportarOrdenMemorando({
      ...DATOS,
      apartados: [
        {
          id: 'x',
          titulo: 'APARTADO SEGUNDO',
          etiqueta: 'Fundamento legal y competencia',
          tipo: 'texto',
          contenido: 'El contenido va a la derecha de la etiqueta.',
        },
        {
          id: 'y',
          titulo: 'APARTADO TERCERO',
          etiqueta: 'Disposiciones generales',
          tipo: 'lista',
          contenido: 'Primera\nSegunda',
        },
      ],
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('conNegrita · soporte de **negrita** (con y sin tokens)', () => {
  it('un texto sin ** se devuelve TAL CUAL, con sus tildes y ñ intactas', () => {
    expect(conNegrita('Inspección en Simbaña: la Dirección asignó.')).toBe(
      'Inspección en Simbaña: la Dirección asignó.',
    );
  });

  it('resalta **texto** y deja el resto normal', () => {
    expect(conNegrita('antes **medio** después')).toEqual([
      { text: 'antes ', bold: false },
      { text: 'medio', bold: true },
      { text: ' después', bold: false },
    ]);
  });

  it('negrita CON token ya sustituido (**{{designado}}** → **VALOR**) sale en negrita', () => {
    // El servicio sustituye el token ANTES de llegar aquí; conNegrita solo ve el valor entre **…**.
    expect(
      conNegrita(
        'asignó al **DE LA GUERRA FRANKLIN (Director)** la validación.',
      ),
    ).toEqual([
      { text: 'asignó al ', bold: false },
      { text: 'DE LA GUERRA FRANKLIN (Director)', bold: true },
      { text: ' la validación.', bold: false },
    ]);
  });

  it('conserva tildes y ñ DENTRO de la negrita (sin corrupción de caracteres)', () => {
    expect(conNegrita('**Inspección Simbaña asignó**')).toEqual([
      { text: '', bold: false },
      { text: 'Inspección Simbaña asignó', bold: true },
      { text: '', bold: false },
    ]);
  });
});

describe('APARTADOS_POR_DEFECTO · Apartado segundo (texto fiel del original)', () => {
  const porId = Object.fromEntries(APARTADOS_POR_DEFECTO.map((a) => [a.id, a]));

  it('trae el texto completo con sus tokens y la negrita', () => {
    const segundo = porId.segundo;
    expect(segundo.tipo).toBe('texto');
    expect(segundo.contenido).toContain(
      '**{{direccionResponsable}}** de la AMC, es responsable de programar y disponer',
    );
    expect(segundo.contenido).toContain(
      'Mediante Memorando Nro. **{{numeroMemorando}}**, de {{fechaMemorando}}, la Directora ',
    );
    expect(segundo.contenido).toContain(
      'asignó al **{{designado}}** la validación',
    );
  });
});

describe('exportarOrdenMemorando · codificación UTF-8 (tildes y ñ)', () => {
  it('genera un PDF válido con «Simbaña», «Inspección» y «asignó» sin lanzar ni corromper', async () => {
    const buffer = await exportarOrdenMemorando({
      ...DATOS,
      para: {
        nombre: 'SIMBAÑA PÉREZ JUAN',
        cargo: 'Inspección técnica',
        dependencia: 'Dirección Metropolitana de Inspección',
      },
      apartados: [
        {
          id: 'segundo',
          titulo: 'APARTADO SEGUNDO',
          etiqueta: 'Fundamento legal y competencia',
          tipo: 'texto',
          contenido:
            'La Dirección Metropolitana de Inspección asignó la validación en Simbaña.',
        },
      ],
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('exportarOrdenMemorando · vista previa de la plantilla (D17)', () => {
  it('con modoVistaPrevia los datos de la orden vacíos se pintan como marcador gris y el PDF sale igual', async () => {
    const buffer = await exportarOrdenMemorando({
      ...DATOS,
      para: { nombre: '', cargo: '', dependencia: '' },
      nut: '',
      elaboradoPor: '',
      operativos: [],
      modoVistaPrevia: true,
    });

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('exportarOrdenMemorando · sin valores cableados (punto 7, 2026-10-05)', () => {
  /** La definición que el exportador entrega al motor de PDF, como texto, para buscar en ella. */
  const definicionComoTexto = async (
    datos: DatosOrdenMemorando,
  ): Promise<string> => {
    const espia = jest.spyOn(motor, 'generarDocumento');
    await exportarOrdenMemorando(datos);
    const definicion = espia.mock.calls[0][0];
    espia.mockRestore();
    return JSON.stringify(definicion);
  };

  it('el ASUNTO usa la dirección responsable de la plantilla, no una cableada', async () => {
    const texto = await definicionComoTexto({
      ...DATOS,
      direccionResponsable: 'Dirección de Prueba Uno',
    });

    expect(texto).toContain('Dirección de Prueba Uno');
    expect(texto).toContain(' - Orden de Servicio Nro. ');
    expect(texto).not.toContain(
      'Dirección Metropolitana de Inspección - Orden de Servicio',
    );
  });

  it('sin dirección responsable, el ASUNTO la marca como pendiente en vez de inventarla', async () => {
    const texto = await definicionComoTexto({
      ...DATOS,
      direccionResponsable: '',
    });

    expect(texto).toContain('[Dirección responsable]');
  });

  it('ningún valor de ejemplo llega al documento desde el código', async () => {
    // Un destinatario neutro: así lo único que puede traer un ejemplo es el CÓDIGO del exportador.
    const texto = await definicionComoTexto({
      ...DATOS,
      para: { nombre: 'PÉREZ ANA', cargo: 'Inspectora', dependencia: '' },
      numeroMemorando: '',
      firmante: { nombre: '', cargo: '', dependencia: '' },
    });

    for (const ejemplo of [
      '9379',
      '17 de junio',
      'Funcionario Directivo',
      '(ejemplo)',
      'Pruebas tecnicas',
    ]) {
      expect(texto).not.toContain(ejemplo);
    }
  });
});
