/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: resolver-tokens.spec.ts
 * Responsabilidad: Verificar la ÚNICA resolución de tokens y faltantes (D12/D14/D15/D16/F22).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `resolverTokens(apartados, fuente)` es la única verdad para los datos y los faltantes. Aquí se
 * fijan sus reglas: un token es obligatorio solo si la plantilla lo usa (D15), salvo los
 * estructurales (cargo/dependencia/NUT) y el firmante (F22); `numeroOrden`/`ciudadFecha`/
 * `fechaEmision` NUNCA son faltantes (D14/D16); un dato vacío o en blanco cuenta como faltante.
 *
 * Y cada faltante ya NO es una cadena sino `{ token, etiqueta, origen }` (D16): hay una prueba POR
 * TOKEN que fija de qué fuente sale y con qué `origen` se agrupa (persona/configuración/plantilla).
 * El FIRMANTE (nombre, cargo y dependencia) vive ahora en los datos generales de la plantilla
 * (2026-10-02), así que su origen es «plantilla» y es estructural (el bloque de firma siempre va).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  resolverTokens,
  tokensUsados,
  type ApartadoConTokens,
  type Faltante,
  type FuenteTokens,
  type OrigenFaltante,
} from './resolver-tokens';

/** Una plantilla que usa `numeroMemorando` y `fechaEmision`, y nada más. */
const PLANTILLA: ApartadoConTokens[] = [
  {
    titulo: 'APARTADO SEGUNDO',
    contenido:
      'Mediante Memorando Nro. {{numeroMemorando}} del {{fechaEmision}}.',
  },
];

/** Una plantilla que usa un token concreto, para probarlo aislado. */
function plantillaCon(token: string): ApartadoConTokens[] {
  return [{ titulo: 'APARTADO', contenido: `Usa {{${token}}}.` }];
}

const FUENTE_LLENA: FuenteTokens = {
  nombre: 'PÉREZ JUAN',
  cargo: 'Agente',
  dependencia: 'DMIP',
  fechaEmision: '25/06/2026',
  ciudadFecha: 'Quito, D.M., 25 de junio de 2026',
  direccionResponsable: 'Dirección Metropolitana de Inspección',
  siglasUnidad: 'AMC',
  numeroMemorando: 'MEM-001',
  fechaMemorando: '17 de junio de 2026',
  designado: 'Mgs. PÉREZ JUAN (Director)',
  nut: 'NUT-9',
  elaboradoPor: 'Analista',
  firmante: 'DIRECTOR X',
  firmanteCargo: 'DIRECTOR',
  firmanteDependencia: 'AMC',
  numeroOrden: null,
};

/** La fuente con algunos campos sobreescritos. */
function fuente(parcial: Partial<FuenteTokens>): FuenteTokens {
  return { ...FUENTE_LLENA, ...parcial };
}

describe('tokensUsados', () => {
  it('lee los tokens de título, etiqueta y contenido de todos los apartados', () => {
    const usados = tokensUsados([
      {
        titulo: '{{siglasUnidad}}',
        etiqueta: '{{nut}}',
        contenido: '{{numeroMemorando}}',
      },
    ]);
    expect(usados).toEqual(new Set(['siglasUnidad', 'nut', 'numeroMemorando']));
  });
});

/**
 * UNA PRUEBA POR TOKEN (D16). Cada fila dice de dónde sale el dato (`campo` de la fuente), con qué
 * `etiqueta` y `origen` se reporta, y si es estructural (obligatorio aunque la plantilla no lo use).
 */
const TOKENS_DEL_CUERPO: {
  token: string;
  campo: keyof FuenteTokens;
  etiqueta: string;
  origen: OrigenFaltante;
  estructural: boolean;
}[] = [
  {
    token: 'nombre',
    campo: 'nombre',
    etiqueta: 'Nombre',
    origen: 'persona',
    estructural: false,
  },
  {
    token: 'cargo',
    campo: 'cargo',
    etiqueta: 'Cargo del destinatario',
    origen: 'persona',
    estructural: true,
  },
  {
    token: 'dependencia',
    campo: 'dependencia',
    etiqueta: 'Dependencia del destinatario',
    origen: 'persona',
    estructural: true,
  },
  {
    token: 'numeroMemorando',
    campo: 'numeroMemorando',
    etiqueta: 'Número de memorando',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'fechaMemorando',
    campo: 'fechaMemorando',
    etiqueta: 'Fecha del memorando',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'designado',
    campo: 'designado',
    etiqueta: 'Funcionario designado',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'nut',
    campo: 'nut',
    etiqueta: 'NUT',
    origen: 'cuadro',
    estructural: true,
  },
  {
    token: 'elaboradoPor',
    campo: 'elaboradoPor',
    etiqueta: 'Elaborado por',
    origen: 'cuadro',
    estructural: false,
  },
  {
    token: 'direccionResponsable',
    campo: 'direccionResponsable',
    etiqueta: 'Dirección responsable',
    origen: 'plantilla',
    estructural: false,
  },
  {
    token: 'siglasUnidad',
    campo: 'siglasUnidad',
    etiqueta: 'Siglas de la unidad',
    origen: 'configuracion',
    estructural: false,
  },
  {
    token: 'firmante',
    campo: 'firmante',
    etiqueta: 'Firmante',
    origen: 'firmante',
    estructural: true,
  },
  {
    token: 'firmanteCargo',
    campo: 'firmanteCargo',
    etiqueta: 'Cargo del firmante',
    origen: 'firmante',
    estructural: true,
  },
  {
    token: 'firmanteDependencia',
    campo: 'firmanteDependencia',
    etiqueta: 'Dependencia del firmante',
    origen: 'firmante',
    estructural: true,
  },
];

describe('resolverTokens · un faltante por token, con su origen (D16)', () => {
  it.each(TOKENS_DEL_CUERPO)(
    '«$token» vacío, usado por la plantilla, falta como {etiqueta:$etiqueta, origen:$origen}',
    ({ token, campo, etiqueta, origen }) => {
      const { faltantes } = resolverTokens(
        plantillaCon(token),
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes).toContainEqual<Faltante>({ token, etiqueta, origen });
    },
  );

  it.each(TOKENS_DEL_CUERPO.filter((t) => t.estructural))(
    '«$token» es estructural: falta aunque la plantilla NO lo nombre',
    ({ token, campo, etiqueta, origen }) => {
      const sinPlantilla: ApartadoConTokens[] = [
        { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
      ];
      const { faltantes } = resolverTokens(
        sinPlantilla,
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes).toContainEqual<Faltante>({ token, etiqueta, origen });
    },
  );

  it.each(TOKENS_DEL_CUERPO.filter((t) => !t.estructural))(
    '«$token» NO estructural: con la plantilla que no lo usa, no falta aunque esté vacío (D15)',
    ({ token, campo }) => {
      const sinPlantilla: ApartadoConTokens[] = [
        { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
      ];
      const { faltantes } = resolverTokens(
        sinPlantilla,
        fuente({ [campo]: '' } as Partial<FuenteTokens>),
      );
      expect(faltantes.map((f) => f.token)).not.toContain(token);
    },
  );

  it('el cargo del firmante sale de los datos generales de la plantilla (grupo «firmante», F22)', () => {
    const { faltantes } = resolverTokens(
      PLANTILLA,
      fuente({ firmanteCargo: '' }),
    );
    expect(faltantes).toContainEqual<Faltante>({
      token: 'firmanteCargo',
      etiqueta: 'Cargo del firmante',
      origen: 'firmante',
    });
  });

  it('la dependencia del firmante sale de los datos generales de la plantilla (grupo «firmante», F22)', () => {
    const { faltantes } = resolverTokens(
      PLANTILLA,
      fuente({ firmanteDependencia: '' }),
    );
    expect(faltantes).toContainEqual<Faltante>({
      token: 'firmanteDependencia',
      etiqueta: 'Dependencia del firmante',
      origen: 'firmante',
    });
  });
});

describe('resolverTokens · faltantes', () => {
  it('con todo completo y los tokens de la plantilla presentes, no falta nada', () => {
    expect(resolverTokens(PLANTILLA, FUENTE_LLENA).faltantes).toEqual([]);
  });

  it('D14: `numeroOrden` NUNCA es faltante, aunque sea null o vacío', () => {
    const tokens = (parcial: Partial<FuenteTokens>) =>
      resolverTokens(
        plantillaCon('numeroOrden'),
        fuente(parcial),
      ).faltantes.map((f) => f.token);
    expect(tokens({ numeroOrden: null })).not.toContain('numeroOrden');
    expect(tokens({ numeroOrden: '' })).not.toContain('numeroOrden');
  });

  it('D16: `ciudadFecha` y `fechaEmision` se calculan, NUNCA faltan (ni usados ni vacíos)', () => {
    const plantilla: ApartadoConTokens[] = [
      {
        titulo: 'APARTADO',
        contenido: '{{ciudadFecha}} · {{fechaEmision}}',
      },
    ];
    const tokens = resolverTokens(
      plantilla,
      fuente({ ciudadFecha: '', fechaEmision: '' }),
    ).faltantes.map((f) => f.token);
    expect(tokens).not.toContain('ciudadFecha');
    expect(tokens).not.toContain('fechaEmision');
  });

  it('D15: un token que la plantilla NO usa y no es estructural, no cuenta como faltante', () => {
    // `elaboradoPor`, `siglasUnidad`, `ciudadFecha`, `direccionResponsable` no están en PLANTILLA.
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({
        elaboradoPor: '',
        siglasUnidad: '',
        ciudadFecha: '',
        direccionResponsable: '',
      }),
    ).faltantes;
    expect(faltantes).toEqual([]);
  });

  it('D15: un token vacío SÍ cuenta como faltante si la plantilla lo usa', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ numeroMemorando: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
    ]);
  });

  it('los estructurales (cargo/dependencia/NUT) faltan aunque la plantilla no los nombre', () => {
    const sinPlantilla: ApartadoConTokens[] = [
      { titulo: 'APARTADO', contenido: 'Texto sin tokens.' },
    ];
    const faltantes = resolverTokens(
      sinPlantilla,
      fuente({ cargo: '', dependencia: '', nut: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      { token: 'cargo', etiqueta: 'Cargo del destinatario', origen: 'persona' },
      {
        token: 'dependencia',
        etiqueta: 'Dependencia del destinatario',
        origen: 'persona',
      },
      { token: 'nut', etiqueta: 'NUT', origen: 'cuadro' },
    ]);
  });

  it('cuenta como faltante lo vacío o en blanco, no solo lo ausente', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ nut: '   ', numeroMemorando: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
      { token: 'nut', etiqueta: 'NUT', origen: 'cuadro' },
    ]);
  });

  it('F22: si el firmante no tiene cargo/dependencia, ambos faltan (aunque la plantilla no los use)', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({ firmanteCargo: '', firmanteDependencia: '' }),
    ).faltantes;
    expect(faltantes).toEqual<Faltante[]>([
      {
        token: 'firmanteCargo',
        etiqueta: 'Cargo del firmante',
        origen: 'firmante',
      },
      {
        token: 'firmanteDependencia',
        etiqueta: 'Dependencia del firmante',
        origen: 'firmante',
      },
    ]);
  });

  it('recién emitida (todo vacío), lista los requeridos y el firmante, agrupables por origen', () => {
    const faltantes = resolverTokens(
      PLANTILLA,
      fuente({
        cargo: '',
        dependencia: '',
        nut: '',
        numeroMemorando: '',
        fechaEmision: '',
        firmanteCargo: '',
        firmanteDependencia: '',
      }),
    ).faltantes;
    // `fechaEmision` NO aparece: se calcula (D16). `numeroOrden` tampoco (D14). El firmante (cargo y
    // dependencia) vive en la plantilla del Director, pero se agrupa aparte como «firmante» (2026-10-05).
    expect(faltantes).toEqual<Faltante[]>([
      { token: 'cargo', etiqueta: 'Cargo del destinatario', origen: 'persona' },
      {
        token: 'dependencia',
        etiqueta: 'Dependencia del destinatario',
        origen: 'persona',
      },
      {
        token: 'numeroMemorando',
        etiqueta: 'Número de memorando',
        origen: 'plantilla',
      },
      { token: 'nut', etiqueta: 'NUT', origen: 'cuadro' },
      {
        token: 'firmanteCargo',
        etiqueta: 'Cargo del firmante',
        origen: 'firmante',
      },
      {
        token: 'firmanteDependencia',
        etiqueta: 'Dependencia del firmante',
        origen: 'firmante',
      },
    ]);

    // Y se pueden AGRUPAR por origen para el aviso de borrador (E21): persona / plantilla / firmante /
    // cuadro / configuración (2026-10-05).
    const porOrigen = (origen: OrigenFaltante) =>
      faltantes.filter((f) => f.origen === origen).map((f) => f.token);
    expect(porOrigen('persona')).toEqual(['cargo', 'dependencia']);
    expect(porOrigen('plantilla')).toEqual(['numeroMemorando']);
    expect(porOrigen('firmante')).toEqual([
      'firmanteCargo',
      'firmanteDependencia',
    ]);
    expect(porOrigen('cuadro')).toEqual(['nut']);
    expect(porOrigen('configuracion')).toEqual([]);
  });
});

describe('resolverTokens · valores', () => {
  it('devuelve el valor de cada token, con `numeroOrden` nulo mientras es Borrador', () => {
    const { valores } = resolverTokens(PLANTILLA, FUENTE_LLENA);
    expect(valores.numeroMemorando).toBe('MEM-001');
    expect(valores.nombre).toBe('PÉREZ JUAN');
    expect(valores.numeroOrden).toBeNull();
  });
});
