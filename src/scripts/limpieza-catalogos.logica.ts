/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: limpieza-catalogos.logica.ts
 * Responsabilidad: Planificar, reportar y aplicar la limpieza de datos de los catálogos del cuadro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PRIMERO SE MIRA, LUEGO SE TOCA (ajustes de P-08, 2026-10-13).
 *
 * `limpieza-catalogos.ts` es el punto de entrada; aquí vive todo lo demás, con el cliente de
 * Prisma INYECTADO para poder probarlo sin base. Tres pasos que no se mezclan:
 *   1. `planificarLimpieza` solo LEE y devuelve qué cambiaría.
 *   2. `formatearReporte` lo escribe para una persona.
 *   3. `aplicarPlan` lo ejecuta, todo en UNA transacción y con su traza en `t_auditoria`.
 * Sin `--aplicar` el paso 3 no ocurre, y el paso 1 no llama a ningún método de escritura.
 *
 * Partes del plan:
 *   a) Zonales que en realidad son puntos de encuentro («HOSPITAL CARLOS ANDRADE MARIN»): sin uso
 *      se eliminan con sus puntos; con uso y destino conocido se FUSIONAN; con uso y sin destino
 *      se dejan como están («requiere decisión»).
 *   b) Tipos de control a MAYÚSCULAS.
 *   c) Instituciones (mapa aprobado por negocio el 2026-10-13): la denominación completa donde
 *      todavía repite la sigla (`DENOMINACIONES`), y la sigla corta donde la sigla es el nombre
 *      entero (`SIGLAS_CORTAS`). Ninguna otra se inventa.
 *   d) Zonales DE CADA FORMULARIO (`t_zonal_formulario`, 2026-10-13) que no están en formato
 *      título. Si la migración `20261013120000_zonal_por_formulario` aún no se aplicó, esta parte
 *      se reporta como pendiente y no se lee.
 * Las partes a) y d) tocan zonales: se aplican solo con `--incluir-zonales`. Sin él se reportan
 * igual, para decidir con el reporte a la vista. La parte a) borra o fusiona ZONAS DE LA CIUDAD
 * (`t_zonal`) junto con sus zonales de formulario.
 *
 * IDEMPOTENTE: lo aplicado deja de cumplir el criterio que lo seleccionó (el tipo ya está en
 * mayúsculas, la institución ya no repite la sigla, la zonal ya no existe), así que una segunda
 * corrida planifica 0 cambios. Un cambio que chocaría con una restricción única se SALTA y se
 * reporta: nunca se fuerza.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  AccionAuditoria,
  type Prisma,
  type PrismaClient,
  RolDepartamental,
} from '@prisma/client';

import {
  aFormatoTitulo,
  enMayusculas,
  normalizarParaComparar,
} from '../common/utilidades/texto';

/** Lo que el script necesita del cliente de Prisma: lecturas, escrituras y la transacción. */
export type ClienteLimpieza = Pick<
  PrismaClient,
  | '$transaction'
  | '$queryRaw'
  | 'zonal'
  | 'zonalFormulario'
  | 'puntoEncuentro'
  | 'tipoControl'
  | 'institucion'
  | 'usuario'
>;

/** El cliente de la transacción, que es con el que se escribe. */
type Transaccion = Prisma.TransactionClient;

export interface OpcionesLimpieza {
  aplicar: boolean;
  incluirZonales: boolean;
  /** Quien firma la traza. Obligatorio con `aplicar`. */
  usuarioId: number | null;
}

/**
 * Destinos de fusión decididos para las zonales que eran puntos (2026-10-13): el punto
 * equivalente de la Zonal Eugenio Espejo, en el MISMO formulario que el punto que se retira.
 * Una zonal sospechosa que no esté aquí y tenga uso queda «requiere decisión».
 */
export const DESTINOS_DE_FUSION: Readonly<
  Record<string, { zonalCodigo: string; punto: string }>
> = {
  HOSPITAL_CARLOS_ANDRADE_MARIN: {
    zonalCodigo: 'EUGENIO_ESPEJO',
    punto: 'HCAM',
  },
  CAJA_DEL_SEGURO: {
    zonalCodigo: 'EUGENIO_ESPEJO',
    punto: 'KFC - Caja del Seguro',
  },
  BOULEVARD_NNUU: { zonalCodigo: 'EUGENIO_ESPEJO', punto: 'PMO NNUU y Shyris' },
};

/**
 * Denominaciones confirmadas por el negocio (2026-10-13), por SIGLA. Se cargan solo donde la
 * denominación todavía repite la sigla. Ninguna otra se inventa.
 */
export const DENOMINACIONES: Readonly<Record<string, string>> = {
  AMC: 'Agencia Metropolitana de Control',
  CACMQ: 'Cuerpo de Agentes de Control Metropolitano de Quito',
  CBQ: 'Cuerpo de Bomberos de Quito',
  EMGIRS:
    'Empresa Pública Metropolitana de Gestión Integral de Residuos Sólidos',
  PPNN: 'Policía Nacional',
  AMT: 'Agencia Metropolitana de Tránsito',
  COE: 'Comité de Operaciones de Emergencia',
  EPMMOP: 'Empresa Pública Metropolitana de Movilidad y Obras Públicas',
};

/**
 * Siglas cortas confirmadas por el negocio (2026-10-13), por la sigla ACTUAL —que hoy es el nombre
 * entero—. Se cambia solo la sigla, y solo donde la denominación sigue siendo ese mismo nombre;
 * la sigla es lo que imprime la orden de servicio. «Administración Seguridad», «Administración
 * Zonal», «Comisaría», «Jefatura Zonal» y «Migración» no tienen sigla decidida: no se tocan.
 */
export const SIGLAS_CORTAS: Readonly<Record<string, string>> = {
  'SECRETARIA DE SEGURIDAD': 'SS',
  'CUERPO DE BOMBEROS DE QUITO': 'CBQ',
  'FUERZAS ARMADAS': 'FF.AA.',
};

export interface PuntoDeZonal {
  id: number;
  nombre: string;
  activo: boolean;
  formularioId: number;
  formularioNumero: number;
  operativos: number;
  /** Solo en la fusión: el punto equivalente de la zonal destino en su formulario. */
  destinoId?: number | null;
}

export interface ReferenciasZonal {
  operativos: number;
  fichas: number;
  ubicaciones: number;
  tramos: number;
  traslados: number;
  talleres: number;
}

export type AccionZonal = 'ELIMINAR' | 'FUSIONAR' | 'REQUIERE_DECISION';

export interface ZonalSospechosa {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  puntos: PuntoDeZonal[];
  referencias: ReferenciasZonal;
  accion: AccionZonal;
  /** Por qué se propone esa acción, para el reporte. */
  motivo: string;
  destinoZonalId: number | null;
}

export interface CambioNombre {
  id: number;
  formularioId: number;
  anterior: string;
  nuevo: string;
  /** Solo instituciones: qué columna cambia. Por omisión, la denominación. */
  campo?: 'sigla' | 'nombre';
}

export interface CambioSaltado extends CambioNombre {
  motivo: string;
}

export interface PlanLimpieza {
  zonales: ZonalSospechosa[];
  tipos: CambioNombre[];
  tiposSaltados: CambioSaltado[];
  instituciones: CambioNombre[];
  institucionesSaltadas: CambioSaltado[];
  zonalesTitulo: CambioNombre[];
  zonalesTituloSaltadas: CambioSaltado[];
  /** La tabla de zonales de formulario aún no existe (migración sin aplicar): d) queda pendiente. */
  zonalesTituloPendiente: boolean;
}

export interface ResumenAplicado {
  zonalesEliminadas: number;
  zonalesFusionadas: number;
  tipos: number;
  instituciones: number;
  zonalesRenombradas: number;
}

/** ¿El nombre de esta zonal es el de un lugar escrito en mayúsculas, no el de una zonal? */
export function esZonalSospechosa(zonal: {
  nombre: string;
  esDmq: boolean;
}): boolean {
  if (zonal.esDmq) return false;
  if (!/\p{L}/u.test(zonal.nombre)) return false;
  if (zonal.nombre !== zonal.nombre.toLocaleUpperCase('es')) return false;
  return !normalizarParaComparar(zonal.nombre).startsWith('ZONAL');
}

const totalReferencias = (r: ReferenciasZonal): number =>
  r.operativos + r.fichas + r.ubicaciones + r.tramos + r.traslados + r.talleres;

// ─────────────────────────── 1. Planificar (solo lecturas) ───────────────────────────

export async function planificarLimpieza(
  db: ClienteLimpieza,
): Promise<PlanLimpieza> {
  const [zonales, tipos, instituciones] = await Promise.all([
    db.zonal.findMany({
      orderBy: { orden: 'asc' },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        esDmq: true,
        activo: true,
        _count: {
          select: {
            operativos: true,
            funcionarios: true,
            ubicaciones: true,
            tramosDesde: true,
            tramosHacia: true,
            trasladosDesde: true,
            trasladosHacia: true,
            talleres: true,
          },
        },
        puntos: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            nombre: true,
            activo: true,
            formularioId: true,
            formulario: { select: { numero: true } },
            _count: { select: { operativos: true } },
          },
        },
      },
    }),
    db.tipoControl.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, formularioId: true, nombre: true },
    }),
    db.institucion.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, formularioId: true, sigla: true, nombre: true },
    }),
  ]);

  // ── a) Zonales que eran puntos ──
  const sospechosas: ZonalSospechosa[] = [];
  for (const zonal of zonales.filter(esZonalSospechosa)) {
    const puntos: PuntoDeZonal[] = zonal.puntos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      activo: p.activo,
      formularioId: p.formularioId,
      formularioNumero: p.formulario.numero,
      operativos: p._count.operativos,
    }));
    const c = zonal._count;
    const referencias: ReferenciasZonal = {
      operativos: c.operativos + puntos.reduce((s, p) => s + p.operativos, 0),
      fichas: c.funcionarios,
      ubicaciones: c.ubicaciones,
      tramos: c.tramosDesde + c.tramosHacia,
      traslados: c.trasladosDesde + c.trasladosHacia,
      talleres: c.talleres,
    };
    const base = {
      id: zonal.id,
      codigo: zonal.codigo,
      nombre: zonal.nombre,
      activo: zonal.activo,
      puntos,
      referencias,
    };

    if (totalReferencias(referencias) === 0) {
      sospechosas.push({
        ...base,
        accion: 'ELIMINAR',
        motivo: 'Nunca se usó: se elimina con sus puntos.',
        destinoZonalId: null,
      });
      continue;
    }

    const destino = DESTINOS_DE_FUSION[zonal.codigo];
    const zonalDestino = destino
      ? zonales.find((z) => z.codigo === destino.zonalCodigo)
      : undefined;
    if (!destino || !zonalDestino) {
      sospechosas.push({
        ...base,
        accion: 'REQUIERE_DECISION',
        motivo: destino
          ? `No existe la zonal destino ${destino.zonalCodigo}: no se toca.`
          : 'Tiene uso y no hay destino de fusión decidido: no se toca.',
        destinoZonalId: null,
      });
      continue;
    }

    // Cada punto CON operativos necesita su equivalente en el MISMO formulario.
    const clave = normalizarParaComparar(destino.punto);
    let faltaDestino: PuntoDeZonal | null = null;
    for (const punto of puntos) {
      const equivalente = zonalDestino.puntos.find(
        (p) =>
          p.formularioId === punto.formularioId &&
          normalizarParaComparar(p.nombre) === clave,
      );
      punto.destinoId = equivalente?.id ?? null;
      if (punto.operativos > 0 && !equivalente) faltaDestino = punto;
    }
    if (faltaDestino) {
      sospechosas.push({
        ...base,
        accion: 'REQUIERE_DECISION',
        motivo: `El formulario ${faltaDestino.formularioNumero} no tiene «${destino.punto}» en ${zonalDestino.nombre}: no se toca.`,
        destinoZonalId: null,
      });
      continue;
    }
    sospechosas.push({
      ...base,
      accion: 'FUSIONAR',
      motivo: `Se fusiona con «${destino.punto}» de ${zonalDestino.nombre}.`,
      destinoZonalId: zonalDestino.id,
    });
  }

  // ── b) Tipos de control a mayúsculas ──
  const tiposPlan: CambioNombre[] = [];
  const tiposSaltados: CambioSaltado[] = [];
  const ocupadosTipo = new Set(
    tipos.map((t) => `${t.formularioId}|${t.nombre}`),
  );
  for (const tipo of tipos) {
    const nuevo = enMayusculas(tipo.nombre);
    if (nuevo === tipo.nombre) continue;
    const cambio = {
      id: tipo.id,
      formularioId: tipo.formularioId,
      anterior: tipo.nombre,
      nuevo,
    };
    const llave = `${tipo.formularioId}|${nuevo}`;
    if (ocupadosTipo.has(llave)) {
      tiposSaltados.push({
        ...cambio,
        motivo: 'Ya existe un tipo con ese nombre en el formulario.',
      });
      continue;
    }
    ocupadosTipo.add(llave);
    tiposPlan.push(cambio);
  }

  // ── c) Instituciones: denominación completa y sigla corta ──
  // Las dos son únicas DENTRO del formulario (sin tildes ni mayúsculas): lo que chocaría se salta.
  const instPlan: CambioNombre[] = [];
  const instSaltadas: CambioSaltado[] = [];
  const llave = (formularioId: number, valor: string) =>
    `${formularioId}|${normalizarParaComparar(valor)}`;
  const ocupadasNombre = new Set(
    instituciones.map((i) => llave(i.formularioId, i.nombre)),
  );
  const ocupadasSigla = new Set(
    instituciones.map((i) => llave(i.formularioId, i.sigla)),
  );
  for (const inst of instituciones) {
    // Solo filas que todavía repiten la sigla como denominación.
    if (
      normalizarParaComparar(inst.nombre) !== normalizarParaComparar(inst.sigla)
    ) {
      continue;
    }
    const denominacion = DENOMINACIONES[normalizarParaComparar(inst.sigla)];
    const sigla = SIGLAS_CORTAS[normalizarParaComparar(inst.sigla)];
    const base = { id: inst.id, formularioId: inst.formularioId };

    if (denominacion) {
      const cambio = {
        ...base,
        campo: 'nombre' as const,
        anterior: inst.nombre,
        nuevo: denominacion,
      };
      const clave = llave(inst.formularioId, denominacion);
      if (ocupadasNombre.has(clave)) {
        instSaltadas.push({
          ...cambio,
          motivo: 'Otra institución del formulario ya tiene esa denominación.',
        });
      } else {
        ocupadasNombre.add(clave);
        instPlan.push(cambio);
      }
    }
    if (sigla) {
      const cambio = {
        ...base,
        campo: 'sigla' as const,
        anterior: inst.sigla,
        nuevo: sigla,
      };
      const clave = llave(inst.formularioId, sigla);
      if (ocupadasSigla.has(clave)) {
        instSaltadas.push({
          ...cambio,
          motivo: 'Otra institución del formulario ya tiene esa sigla.',
        });
      } else {
        ocupadasSigla.add(clave);
        instPlan.push(cambio);
      }
    }
  }

  // ── d) Zonales DE CADA FORMULARIO en formato título ──
  const { titulo, tituloSaltadas, pendiente } = await zonalesATitulo(
    db,
    new Set(sospechosas.map((z) => z.id)),
  );

  return {
    zonales: sospechosas,
    tipos: tiposPlan,
    tiposSaltados,
    instituciones: instPlan,
    institucionesSaltadas: instSaltadas,
    zonalesTitulo: titulo,
    zonalesTituloSaltadas: tituloSaltadas,
    zonalesTituloPendiente: pendiente,
  };
}

/**
 * La parte d): las zonales de formulario que no están en formato título, salvo las de zonas que
 * la parte a) ya resuelve. El nombre es único dentro del formulario: lo que chocaría se salta.
 * Tolera que la tabla aún no exista —el reporte puede correr antes de la migración—.
 */
async function zonalesATitulo(
  db: ClienteLimpieza,
  zonasDeA: Set<number>,
): Promise<{
  titulo: CambioNombre[];
  tituloSaltadas: CambioSaltado[];
  pendiente: boolean;
}> {
  const [tabla] = await db.$queryRaw<{ existe: boolean }[]>`
    SELECT to_regclass('public.t_zonal_formulario') IS NOT NULL AS existe`;
  if (!tabla?.existe)
    return { titulo: [], tituloSaltadas: [], pendiente: true };

  const filas = await db.zonalFormulario.findMany({
    orderBy: [{ formularioId: 'asc' }, { orden: 'asc' }],
    select: { id: true, formularioId: true, zonaId: true, nombre: true },
  });
  const titulo: CambioNombre[] = [];
  const tituloSaltadas: CambioSaltado[] = [];
  for (const fila of filas) {
    if (zonasDeA.has(fila.zonaId)) continue;
    const nuevo = aFormatoTitulo(fila.nombre);
    if (nuevo === fila.nombre) continue;
    const cambio = {
      id: fila.id,
      formularioId: fila.formularioId,
      anterior: fila.nombre,
      nuevo,
    };
    const choca = filas.some(
      (otra) =>
        otra.id !== fila.id &&
        otra.formularioId === fila.formularioId &&
        normalizarParaComparar(otra.nombre) === normalizarParaComparar(nuevo),
    );
    if (choca) {
      tituloSaltadas.push({
        ...cambio,
        motivo: 'Otra zonal del formulario ya tiene ese nombre.',
      });
      continue;
    }
    titulo.push(cambio);
  }
  return { titulo, tituloSaltadas, pendiente: false };
}

/** Cuántas escrituras haría el plan con estas opciones (0 = no hay nada que aplicar). */
export function cambiosPendientes(
  plan: PlanLimpieza,
  opciones: Pick<OpcionesLimpieza, 'incluirZonales'>,
): number {
  const zonales = opciones.incluirZonales
    ? plan.zonales.filter((z) => z.accion !== 'REQUIERE_DECISION').length +
      plan.zonalesTitulo.length
    : 0;
  return zonales + plan.tipos.length + plan.instituciones.length;
}

// ─────────────────────────── 2. Reportar ───────────────────────────

export function formatearReporte(
  plan: PlanLimpieza,
  opciones: OpcionesLimpieza,
): string {
  const l: string[] = [];
  const modo = opciones.aplicar ? 'APLICAR' : 'REPORTE (no se modifica nada)';
  l.push(`Limpieza de catálogos del cuadro · modo ${modo}`);
  l.push(
    `Zonales: ${opciones.incluirZonales ? 'se aplican' : 'solo se reportan (falta --incluir-zonales)'}`,
  );
  l.push('');

  l.push(`a) Zonales que parecen puntos de encuentro: ${plan.zonales.length}`);
  for (const z of plan.zonales) {
    const r = z.referencias;
    l.push(
      `  · [${z.id}] ${z.nombre} (${z.codigo}, ${z.activo ? 'activa' : 'inactiva'}) → ${z.accion}: ${z.motivo}`,
    );
    l.push(
      `      referencias: operativos ${r.operativos}, fichas ${r.fichas}, ubicaciones ${r.ubicaciones}, tramos ${r.tramos}, traslados ${r.traslados}, talleres ${r.talleres}`,
    );
    for (const p of z.puntos) {
      const destino =
        z.accion === 'FUSIONAR' && p.operativos > 0
          ? ` → punto ${p.destinoId ?? '¿?'}`
          : '';
      l.push(
        `      punto [${p.id}] form ${p.formularioNumero} «${p.nombre}» ${p.activo ? 'activo' : 'inactivo'}, ${p.operativos} operativos${destino}`,
      );
    }
  }
  l.push('');

  const lista = (
    titulo: string,
    cambios: CambioNombre[],
    saltados: CambioSaltado[],
    conFormulario: boolean,
  ) => {
    l.push(`${titulo}: ${cambios.length}`);
    for (const c of cambios) {
      const form = conFormulario ? ` form_id ${c.formularioId}` : '';
      const campo = c.campo === 'sigla' ? ' sigla' : '';
      l.push(`  · [${c.id}]${form}${campo} «${c.anterior}» → «${c.nuevo}»`);
    }
    if (saltados.length > 0) {
      l.push(`  Se saltan ${saltados.length}:`);
      for (const s of saltados) {
        l.push(`  ! [${s.id}] «${s.anterior}» → «${s.nuevo}»: ${s.motivo}`);
      }
    }
    l.push('');
  };
  lista(
    'b) Tipos de control a MAYÚSCULAS',
    plan.tipos,
    plan.tiposSaltados,
    true,
  );
  lista(
    'c) Instituciones: denominación completa y sigla corta',
    plan.instituciones,
    plan.institucionesSaltadas,
    true,
  );
  if (plan.zonalesTituloPendiente) {
    l.push(
      'd) Zonales de formulario a formato título: pendiente (falta aplicar la migración 20261013120000_zonal_por_formulario).',
    );
    l.push('');
  } else {
    lista(
      'd) Zonales de formulario a formato título',
      plan.zonalesTitulo,
      plan.zonalesTituloSaltadas,
      true,
    );
  }

  l.push(
    `Cambios que se aplicarían con estas opciones: ${cambiosPendientes(plan, opciones)}`,
  );
  return l.join('\n');
}

// ─────────────────────────── 3. Aplicar (una transacción) ───────────────────────────

const CORRELACION = 'limpieza-catalogos-2026-10-13';

export async function aplicarPlan(
  db: ClienteLimpieza,
  plan: PlanLimpieza,
  opciones: OpcionesLimpieza,
): Promise<ResumenAplicado> {
  const usuarioId = opciones.usuarioId;
  if (usuarioId === null) {
    throw new Error(
      'Para aplicar indique --usuario=<id>: es quien firma la traza.',
    );
  }
  const usuario = await db.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true },
  });
  if (!usuario) throw new Error(`No existe el usuario ${usuarioId}.`);

  return db.$transaction(async (tx) => {
    const traza = (
      entidad: string,
      entidadId: number,
      accion: AccionAuditoria,
      cambio?: { campo: string; valorAnterior?: string; valorNuevo?: string },
    ) =>
      tx.auditoria.create({
        data: {
          entidad,
          entidadId,
          accion,
          usuario: usuarioId,
          rol: RolDepartamental.ADMINISTRADOR,
          correlacion: CORRELACION,
          ...cambio,
        },
      });

    const resumen: ResumenAplicado = {
      zonalesEliminadas: 0,
      zonalesFusionadas: 0,
      tipos: 0,
      instituciones: 0,
      zonalesRenombradas: 0,
    };

    for (const tipo of plan.tipos) {
      await tx.tipoControl.update({
        where: { id: tipo.id },
        data: { nombre: tipo.nuevo },
      });
      await traza('t_tipo_control', tipo.id, AccionAuditoria.ACTUALIZAR, {
        campo: 'tico_nombre',
        valorAnterior: tipo.anterior,
        valorNuevo: tipo.nuevo,
      });
      resumen.tipos += 1;
    }

    for (const inst of plan.instituciones) {
      const esSigla = inst.campo === 'sigla';
      await tx.institucion.update({
        where: { id: inst.id },
        data: esSigla ? { sigla: inst.nuevo } : { nombre: inst.nuevo },
      });
      await traza('t_institucion', inst.id, AccionAuditoria.ACTUALIZAR, {
        campo: esSigla ? 'inst_sigla' : 'inst_nombre',
        valorAnterior: inst.anterior,
        valorNuevo: inst.nuevo,
      });
      resumen.instituciones += 1;
    }

    if (!opciones.incluirZonales) return resumen;

    for (const zonal of plan.zonales) {
      if (zonal.accion === 'REQUIERE_DECISION') continue;
      if (zonal.accion === 'FUSIONAR' && zonal.destinoZonalId !== null) {
        await fusionarZonal(
          tx,
          zonal,
          zonal.destinoZonalId,
          !plan.zonalesTituloPendiente,
          traza,
        );
        resumen.zonalesFusionadas += 1;
      }
      for (const punto of zonal.puntos) {
        await traza('t_punto_encuentro', punto.id, AccionAuditoria.ELIMINAR);
      }
      await tx.puntoEncuentro.deleteMany({ where: { zonalId: zonal.id } });
      // Sus zonales de formulario van después de sus puntos (la FK del punto las exige) y antes
      // de la zona. Los traslados de la zona caen en cascada: la destino conserva los suyos.
      if (!plan.zonalesTituloPendiente) {
        await tx.zonalFormulario.deleteMany({ where: { zonaId: zonal.id } });
      }
      await tx.zonal.delete({ where: { id: zonal.id } });
      await traza('t_zonal', zonal.id, AccionAuditoria.ELIMINAR);
      if (zonal.accion === 'ELIMINAR') resumen.zonalesEliminadas += 1;
    }

    for (const cambio of plan.zonalesTitulo) {
      await tx.zonalFormulario.update({
        where: { id: cambio.id },
        data: { nombre: cambio.nuevo },
      });
      await traza('t_zonal_formulario', cambio.id, AccionAuditoria.ACTUALIZAR, {
        campo: 'zofo_nombre',
        valorAnterior: cambio.anterior,
        valorNuevo: cambio.nuevo,
      });
      resumen.zonalesRenombradas += 1;
    }

    return resumen;
  });
}

/** Pasa a la zonal destino todo lo que colgaba de la que se retira, antes de borrarla. */
async function fusionarZonal(
  tx: Transaccion,
  zonal: ZonalSospechosa,
  destinoId: number,
  conZonalesDeFormulario: boolean,
  traza: (
    entidad: string,
    entidadId: number,
    accion: AccionAuditoria,
    cambio?: { campo: string; valorAnterior?: string; valorNuevo?: string },
  ) => Promise<unknown>,
): Promise<void> {
  // Operativos del punto → el punto equivalente del mismo formulario.
  for (const punto of zonal.puntos) {
    if (punto.operativos === 0 || !punto.destinoId) continue;
    const operativos = await tx.operativo.findMany({
      where: { puntoEncuentroId: punto.id },
      select: { id: true },
    });
    await tx.operativo.updateMany({
      where: { puntoEncuentroId: punto.id },
      data: { puntoEncuentroId: punto.destinoId },
    });
    for (const operativo of operativos) {
      await traza('t_operativo', operativo.id, AccionAuditoria.ACTUALIZAR, {
        campo: 'pcto_id',
        valorAnterior: String(punto.id),
        valorNuevo: String(punto.destinoId),
      });
    }
  }

  // Zonales del operativo: la llave es (operativo, zonal); si ya tenía la destino, sobra la fila.
  const filas = await tx.operativoZonal.findMany({
    where: { zonalId: zonal.id },
    select: {
      operativoId: true,
      operativo: { select: { formularioId: true } },
    },
  });

  // Cada formulario de esos operativos debe TENER la zonal destino (2026-10-13): si no la tenía,
  // se le crea con el nombre y el orden de su zona de la ciudad.
  if (conZonalesDeFormulario) {
    const zona = await tx.zonal.findUnique({ where: { id: destinoId } });
    const formularios = new Set(filas.map((f) => f.operativo.formularioId));
    for (const formularioId of formularios) {
      if (!zona) break;
      await tx.zonalFormulario.upsert({
        where: { formularioId_zonaId: { formularioId, zonaId: destinoId } },
        update: {},
        create: {
          formularioId,
          zonaId: destinoId,
          nombre: zona.nombre,
          activo: zona.activo,
          orden: zona.orden,
        },
      });
    }
  }

  for (const fila of filas) {
    const yaTiene = await tx.operativoZonal.findUnique({
      where: {
        operativoId_zonalId: {
          operativoId: fila.operativoId,
          zonalId: destinoId,
        },
      },
      select: { operativoId: true },
    });
    const llave = {
      operativoId_zonalId: { operativoId: fila.operativoId, zonalId: zonal.id },
    };
    if (yaTiene) {
      await tx.operativoZonal.delete({ where: llave });
    } else {
      await tx.operativoZonal.update({
        where: llave,
        data: { zonalId: destinoId },
      });
    }
  }

  await tx.funcionario.updateMany({
    where: { zonalId: zonal.id },
    data: { zonalId: destinoId },
  });
  await tx.ubicacionFlota.updateMany({
    where: { zonalId: zonal.id },
    data: { zonalId: destinoId },
  });
  await tx.tramoTransporte.updateMany({
    where: { zonalOrigenId: zonal.id },
    data: { zonalOrigenId: destinoId },
  });
  await tx.tramoTransporte.updateMany({
    where: { zonalDestinoId: zonal.id },
    data: { zonalDestinoId: destinoId },
  });
  await tx.disponibilidad.updateMany({
    where: { zonalTallerId: zonal.id },
    data: { zonalTallerId: destinoId },
  });
}

// ─────────────────────────── Orquestación ───────────────────────────

/** Lee las opciones de la línea de comandos. */
export function leerOpciones(argumentos: readonly string[]): OpcionesLimpieza {
  const usuario = argumentos
    .find((a) => a.startsWith('--usuario='))
    ?.slice('--usuario='.length);
  const usuarioId = usuario ? Number(usuario) : null;
  return {
    aplicar: argumentos.includes('--aplicar'),
    incluirZonales: argumentos.includes('--incluir-zonales'),
    usuarioId:
      usuarioId !== null && Number.isInteger(usuarioId) ? usuarioId : null,
  };
}

export async function ejecutarLimpieza(
  db: ClienteLimpieza,
  opciones: OpcionesLimpieza,
  escribir: (texto: string) => void,
): Promise<ResumenAplicado | null> {
  const plan = await planificarLimpieza(db);
  escribir(formatearReporte(plan, opciones));

  if (!opciones.aplicar) return null;
  if (cambiosPendientes(plan, opciones) === 0) {
    escribir('Nada que aplicar.');
    return null;
  }
  const resumen = await aplicarPlan(db, plan, opciones);
  escribir(
    `Aplicado: ${resumen.tipos} tipos, ${resumen.instituciones} instituciones, ` +
      `${resumen.zonalesEliminadas} zonales eliminadas, ${resumen.zonalesFusionadas} fusionadas, ` +
      `${resumen.zonalesRenombradas} renombradas.`,
  );
  return resumen;
}
