/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz Consolidada (P-04)
 * Archivo: exportador-matriz.spec.ts
 * Responsabilidad: Que el documento firmado nombre a todo el personal, con su teléfono.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL PDF ES EL ARTEFACTO QUE SE REPARTE, Y HASTA HOY NO TENÍA NINGUNA PRUEBA.
 *
 * Su celda de personal decía `ULLOA +2`: nombraba a una persona de tres y no daba ningún
 * teléfono. No era una abreviatura, era información que no llegaba al papel — y el papel
 * es lo que llega al funcionario en territorio. Es la columna 3 de `FASE2 §16.1`
 * —PERSONAL ASIGNADO / TELÉFONO— y RF-015 la pide con prioridad alta.
 *
 * SE COMPRUEBA SOBRE EL PDF DE VERDAD, no sobre una función intermedia. El flujo de
 * contenido se descomprime y se decodifica —PDFKit escribe el texto en hexadecimal con
 * la fuente incrustada—, de modo que lo que se afirma es lo que un lector vería. Una
 * prueba contra `personasDe` pasaría aunque el texto nunca llegara a dibujarse.
 *
 * NO SE PRUEBAN LAS COORDENADAS EXACTAS: eso es maquetado, y se comprueba mirando. Se
 * prueba **que estén los nombres y los números**, que es la decisión.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { inflateSync } from 'node:zlib';

import { exportarMatriz } from './exportador-matriz';
import type { MatrizCompuesta } from './matriz-consolidada.service';

/** Una persona del maestro, con lo que el exportador lee de ella. */
const funcionario = (
  apellidos: string,
  nombres: string,
  telefono: string | null,
) => ({ apellidos, nombres, telefono });

const operativo = (
  identificador: string,
  personal: ReturnType<typeof funcionario>[],
) =>
  ({
    id: 1,
    identificador,
    origenId: null,
    origen: null,
    horaInicio: '08:00',
    horaFin: '12:30',
    personal: personal.map((ficha, indice) => ({
      funcionarioId: indice + 1,
      esResponsable: indice === 0,
      funcionario: ficha,
    })),
    zonales: [{ zonal: { nombre: 'EUGENIO ESPEJO' } }],
    puntoEncuentro: { nombre: 'HCAM' },
    puntoLibre: null,
    tipoControl: { nombre: 'Control de espacio público' },
    tipoLibre: null,
    instituciones: [{ institucion: { sigla: 'AMC' } }],
    conductor: null,
    vehiculo: null,
    observaciones: [
      {
        id: 1,
        texto: 'Sin novedad',
        creadoPor: 7,
        creadoPorRol: 'DMIP_OPERATIVOS',
        creadoEn: new Date('2026-08-27T13:40:00.000Z'),
      },
    ],
    creadoPor: 7,
    creadoPorRol: 'DMIP_OPERATIVOS',
    creadoEn: new Date('2026-08-27T13:00:00.000Z'),
    compartirCon: null,
    compartirSolicitadoPor: null,
    compartirSolicitadoEn: null,
    estadoTransporte: 'PROPIOS_MEDIOS',
  }) as unknown as MatrizCompuesta['secciones'][0]['operativos'][0];

const matrizCon = (
  operativos: ReturnType<typeof operativo>[],
): MatrizCompuesta =>
  ({
    cuadro: {
      ordenTrabajo: 'AMC-2026-AGO-27',
      fecha: new Date(Date.UTC(2026, 7, 27)),
      nroSemana: 35,
      anioSemana: 2026,
      estado: 'APROBADO',
    },
    fechaNatural: 'jueves 27 de agosto de 2026',
    totales: {
      operativos: operativos.length,
      alertas: 0,
      formulariosSinCarga: 0,
    },
    flota: null,
    secciones: [
      {
        formulario: {
          numero: 1,
          codigo: 'FIJOS',
          nombre: 'OPERATIVOS DE CONTROL FIJOS',
          colorFondo: '#A2C4C9',
          colorAcento: '#000000',
          colorNombre: 'verde azulado',
        },
        responsable: 'DMIP Operativos',
        evidencia: null,
        operativos,
      },
    ],
  }) as unknown as MatrizCompuesta;

/**
 * El texto visible del PDF.
 *
 * PDFKit comprime el flujo de contenido y escribe cada cadena en hexadecimal contra la
 * fuente incrustada, de modo que buscar el literal en el búfer no encuentra nada. Se
 * inflan los flujos y se decodifican los operadores de texto.
 */
const textoDelPdf = async (matriz: MatrizCompuesta): Promise<string> => {
  const buffer = await exportarMatriz(matriz);
  let contenido = '';
  let cursor = 0;

  while (true) {
    const inicio = buffer.indexOf('stream', cursor);
    if (inicio === -1) break;

    let desde = inicio + 'stream'.length;
    if (buffer[desde] === 0x0d) desde += 1;
    if (buffer[desde] === 0x0a) desde += 1;

    const fin = buffer.indexOf('endstream', desde);
    if (fin === -1) break;

    const crudo = buffer.subarray(desde, fin);
    try {
      contenido += inflateSync(crudo).toString('latin1');
    } catch {
      // Los flujos que no están comprimidos se leen tal cual.
      contenido += crudo.toString('latin1');
    }

    cursor = fin + 'endstream'.length;
  }

  /*
    DENTRO DE UN OPERADOR SE UNE SIN SEPARADOR, ENTRE OPERADORES CON ESPACIO.
    PDFKit parte una misma palabra en varios trozos para aplicar el kerning —«ULLOA» sale
    como «ULLO» + «A»—, así que unir todo con espacios inventaría separaciones que el
    lector no ve. Cada `[...] TJ` es un texto; lo de dentro, un solo texto.
  */
  return [...contenido.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((operador) =>
      [...operador[1].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((pieza) => Buffer.from(pieza[1], 'hex').toString('latin1'))
        .join(''),
    )
    .join(' ');
};

describe('El PDF de la matriz nombra a todo el personal', () => {
  const ULLOA = funcionario('ULLOA', 'JOSSUE', '97 969 0786');
  const MEJIA = funcionario('MEJIA', 'ARIEL', '98 342 9026');
  const SOLANO = funcionario('SOLANO', 'GABRIELA', null);

  it('lleva la columna de teléfono', async () => {
    const texto = await textoDelPdf(matrizCon([operativo('OCF-001', [ULLOA])]));

    expect(texto).toContain('TEL');
    expect(texto).toContain('97 969 0786');
  });

  /**
   * ES LA QUE DISCRIMINA, y la que habría fallado durante meses sin que nadie lo viera.
   * Con `ULLOA +2` la primera prueba pasaba igual: hay un nombre y hay un teléfono.
   */
  it('con tres asignados aparecen los tres, no el primero y un contador', async () => {
    const texto = await textoDelPdf(
      matrizCon([operativo('OCF-002', [ULLOA, MEJIA, SOLANO])]),
    );

    expect(texto).toContain('ULLOA JOSSUE');
    expect(texto).toContain('MEJIA ARIEL');
    expect(texto).toContain('SOLANO GABRIELA');
    expect(texto).not.toContain('+2');
  });

  it('cada uno con su teléfono, y el que no tiene lo dice', async () => {
    const texto = await textoDelPdf(
      matrizCon([operativo('OCF-002', [ULLOA, MEJIA, SOLANO])]),
    );

    expect(texto).toContain('97 969 0786');
    expect(texto).toContain('98 342 9026');
    // `telefono: null` es un caso real del maestro. Se dice, no se deja en blanco.
    expect(texto).toContain('Sin tel');
  });

  it('el identificador del operativo se imprime una sola vez', async () => {
    // Es lo que produce el efecto de celda combinada: tres renglones, un identificador.
    const texto = await textoDelPdf(
      matrizCon([operativo('OCF-002', [ULLOA, MEJIA, SOLANO])]),
    );

    expect(texto.split('OCF-002').length - 1).toBe(1);
  });

  it('un operativo sin personal conserva su fila y lo dice', async () => {
    const texto = await textoDelPdf(matrizCon([operativo('OCF-003', [])]));

    expect(texto).toContain('OCF-003');
    expect(texto).toContain('Sin asignar');
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UN NOMBRE LARGO SE VE ENTERO, NO CORTADO NI PISADO POR LA RAYA. 2026-09-22.
   *
   * Es el defecto que reportó el usuario: nombres como «BAUTISTA MOREIRA MIRIAM GISELLA» que
   * no cabían en un renglón se cortaban con «…» o cruzaban el filete de abajo. Ahora envuelven
   * en su columna y la fila crece. El nombre no cabe en un renglón de 102 pt, así que se parte
   * en dos renglones —dos operadores de texto—; al linealizarlos para la prueba, el salto de
   * renglón queda como espacio, así que se normalizan los espacios antes de comparar. El nombre
   * completo, en orden, debe aparecer (antes salía cortado con «…» y la segunda mitad se perdía).
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('un nombre que ocupa dos renglones aparece completo', async () => {
    const LARGO = funcionario(
      'VILLAVICENCIO MALDONADO',
      'FRANCISCA GUADALUPE',
      '0987654321',
    );
    const texto = await textoDelPdf(matrizCon([operativo('OCF-004', [LARGO])]));
    const normalizado = texto.replace(/\s+/g, ' ');

    expect(normalizado).toContain(
      'VILLAVICENCIO MALDONADO FRANCISCA GUADALUPE',
    );
    // Y su teléfono sigue estando, no lo desplazó el nombre.
    expect(normalizado).toContain('0987654321');
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LOS CÓDIGOS DE UN MISMO LOTE SALEN COMO UN BLOQUE. 2026-09-22.
   *
   * Un registro del 8 (o una patrulla) se reparte en varios operativos que comparten
   * `grupoRegistro`. En el PDF, como en la pantalla, se pintan como UN bloque: cada código en su
   * fila, el nombre por persona con «(n)», y el resto —punto, tipo…— fusionado UNA sola vez.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('agrupa los códigos del mismo lote en un solo bloque, con el nombre por persona', async () => {
    const MARTINEZ = funcionario('MARTINEZ CORDERO', 'BRYAN ALEXANDER', null);
    const AGUIRRE = funcionario('AGUIRRE CORNEJO', 'ALEX SEBASTIAN', null);
    const LOTE = '01684fb8-ab13-474f-adee-7a98f865df21';
    // Cada código es un operativo de UNA persona, con su propio funcionarioId, todos el mismo lote.
    const codigo = (
      identificador: string,
      funcionarioId: number,
      ficha: ReturnType<typeof funcionario>,
    ) =>
      ({
        ...operativo(identificador, []),
        grupoRegistro: LOTE,
        personal: [{ funcionarioId, esResponsable: false, funcionario: ficha }],
      }) as unknown as ReturnType<typeof operativo>;

    const texto = await textoDelPdf(
      matrizCon([
        codigo('IG-001', 1, MARTINEZ),
        codigo('IG-002', 1, MARTINEZ),
        codigo('IT-003', 2, AGUIRRE),
        codigo('IT-004', 2, AGUIRRE),
      ]),
    );
    const normalizado = texto.replace(/\s+/g, ' ');

    // Los cuatro códigos siguen visibles, uno por fila.
    for (const identificador of ['IG-001', 'IG-002', 'IT-003', 'IT-004']) {
      expect(normalizado).toContain(identificador);
    }
    // El nombre se agrupa por persona con «(2)».
    expect(normalizado).toContain('MARTINEZ CORDERO BRYAN ALEXANDER (2)');
    expect(normalizado).toContain('AGUIRRE CORNEJO ALEX SEBASTIAN (2)');
    // El punto de encuentro se fusiona: aparece UNA sola vez para todo el bloque, no cuatro.
    expect(normalizado.split('HCAM').length - 1).toBe(1);
  });

  /**
   * SOLO SE FUSIONA LO QUE REPITE. 2026-09-22. En un bloque, un dato IGUAL en todos los códigos
   * (el punto) se fusiona y sale una vez; uno que DIFIERE (la observación) baja a la fila de cada
   * código, para no ocultar tras el primero el dato que no se repite.
   */
  it('en un bloque, lo que difiere baja por código y lo que repite se fusiona', async () => {
    const MARTINEZ = funcionario('MARTINEZ', 'BRYAN', null);
    const AGUIRRE = funcionario('AGUIRRE', 'ALEX', null);
    const LOTE = 'lote-obs';
    const codigo = (
      identificador: string,
      funcionarioId: number,
      ficha: ReturnType<typeof funcionario>,
      observacion: string,
    ) =>
      ({
        ...operativo(identificador, []),
        grupoRegistro: LOTE,
        personal: [{ funcionarioId, esResponsable: false, funcionario: ficha }],
        observaciones: [
          {
            id: 1,
            texto: observacion,
            creadoPor: 7,
            creadoPorRol: 'DMIP_OPERATIVOS',
            creadoEn: new Date('2026-08-27T13:40:00.000Z'),
          },
        ],
      }) as unknown as ReturnType<typeof operativo>;

    const texto = await textoDelPdf(
      matrizCon([
        codigo('IG-001', 1, MARTINEZ, 'Nota General del bloque'),
        codigo('IT-002', 2, AGUIRRE, 'Nota Tecnica distinta'),
      ]),
    );
    const normalizado = texto.replace(/\s+/g, ' ');

    // El punto REPITE (HCAM en los dos) → se fusiona: una sola vez.
    expect(normalizado.split('HCAM').length - 1).toBe(1);
    // Las observaciones DIFIEREN → cada una baja por su código: aparecen las dos.
    expect(normalizado).toContain('Nota General del bloque');
    expect(normalizado).toContain('Nota Tecnica distinta');
  });
});

/*
  LAS OBSERVACIONES DEL PDF, UNA POR RENGLÓN (2026-10-19, plan «notas-jornada-matriz», J6). Todas,
  la más reciente primero, con el ROL de quien escribió y la hora de Quito; la COMPARTIDA con su
  identificador. Sin notas, «—». Las de igual TEXTO siguen fusionándose en un lote.
*/
describe('El PDF de la matriz imprime cada observación en su renglón', () => {
  const nota = (id: number, texto: string, iso: string) => ({
    id,
    texto,
    creadoPor: 7,
    creadoPorRol: 'DMIP_OPERATIVOS',
    creadoEn: new Date(iso),
  });

  it('cada nota con su rol y su hora, la compartida con su identificador, la más reciente primero', async () => {
    const conNotas = {
      ...operativo('OCPMO-002-20-OCT-2026', []),
      observaciones: [
        nota(1, 'Primera nota', '2026-10-20T13:30:00.000Z'),
        nota(2, 'Pruebas tecnicas 3', '2026-10-20T13:40:00.000Z'),
      ],
      compartirCon: { id: 56, identificador: 'OCPMO-001-20-OCT-2026' },
      compartirSolicitadoEn: new Date('2026-10-20T13:41:00.000Z'),
    } as unknown as ReturnType<typeof operativo>;

    // El identificador largo envuelve por su guion («…-20- OCT…»): se une antes de comparar.
    const normalizado = (await textoDelPdf(matrizCon([conNotas])))
      .replace(/\s+/g, ' ')
      .replace(/- /g, '-');

    expect(normalizado).toContain(
      'Comparte con OCPMO-001-20-OCT-2026 (20/10 08H41)',
    );
    expect(normalizado).toContain(
      'Pruebas tecnicas 3 (DMIP · Unidad de Operativos, 20/10 08H40)',
    );
    expect(normalizado).toContain(
      'Primera nota (DMIP · Unidad de Operativos, 20/10 08H30)',
    );
    // Todas, sin límite, y en orden: la compartida (08H41) antes que las de 08H40 y 08H30.
    const compartida = normalizado.indexOf('Comparte con');
    const segunda = normalizado.indexOf('Pruebas tecnicas 3');
    const primera = normalizado.indexOf('Primera nota');
    expect(compartida).toBeLessThan(segunda);
    expect(segunda).toBeLessThan(primera);
  });

  it('sin notas, la celda dice «—»', async () => {
    const sinNotas = {
      ...operativo('OCF-001', []),
      observaciones: [],
    } as unknown as ReturnType<typeof operativo>;

    const texto = await textoDelPdf(matrizCon([sinNotas]));

    // La raya «—» va en WinAnsi (0x97): al decodificar en latin1 se lee como U+0097.
    expect(texto).toMatch(/Propios {1,2}medios\s+[\u0097—]\s+Sin asignar/);
    expect(texto).not.toContain('Sin novedad');
  });

  it('dos códigos de un lote con la misma nota a otra hora se fusionan: el texto sale una vez', async () => {
    const MARTINEZ = funcionario('MARTINEZ', 'BRYAN', null);
    const AGUIRRE = funcionario('AGUIRRE', 'ALEX', null);
    const codigo = (
      identificador: string,
      funcionarioId: number,
      ficha: ReturnType<typeof funcionario>,
      iso: string,
    ) =>
      ({
        ...operativo(identificador, []),
        grupoRegistro: 'lote-igual',
        personal: [{ funcionarioId, esResponsable: false, funcionario: ficha }],
        observaciones: [nota(funcionarioId, 'Nota repetida del lote', iso)],
      }) as unknown as ReturnType<typeof operativo>;

    const normalizado = (
      await textoDelPdf(
        matrizCon([
          codigo('IG-001', 1, MARTINEZ, '2026-10-20T13:40:00.000Z'),
          codigo('IT-002', 2, AGUIRRE, '2026-10-20T14:10:00.000Z'),
        ]),
      )
    ).replace(/\s+/g, ' ');

    expect(normalizado.split('Nota repetida del lote').length - 1).toBe(1);
  });
});
