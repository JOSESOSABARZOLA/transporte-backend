/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios.repository.ts
 * Responsabilidad: Leer la definición completa de los nueve formularios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * NO DUPLICA a `common/auth/infrastructure/formulario-autorizacion.repository.ts`.
 * Aquel lee cinco columnas —las que deciden la propiedad departamental— y existe para
 * que la cadena de autorización no dependa de un submódulo de negocio. Este lee la
 * definición completa: colores, política de vehículo, áreas admitidas y delimitación
 * de catálogos. Son dos lecturas distintas de la misma tabla, con dueños distintos.
 *
 * SIN ÍNDICES NUEVOS, y es una decisión, no un olvido. `t_formulario` tiene nueve
 * filas: `idx_formulario_orden` e `idx_formulario_rol_dueno` ya existen y el filtro
 * por `form_rol_compartido` recorre la tabla entera en menos tiempo del que costaría
 * consultar un índice. Ver M07_FORMULARIOS_CATALOGOS.md §3.
 */

import { Injectable } from '@nestjs/common';
import {
  AccesoFormulario,
  EstadoCuadro,
  type AreaPersonal,
  type FormularioPrefijo,
  type PoliticaVehiculo,
  type Prisma,
  type RolDepartamental,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/** Formulario con las áreas de personal que admite. */
export type FormularioConAreas = Prisma.FormularioGetPayload<{
  include: { areas: true; roles: true };
}>;

/** Formulario con áreas y prefijos: lo que la pantalla de administración necesita para editar. */
export type FormularioCompleto = Prisma.FormularioGetPayload<{
  include: { areas: true; prefijos: true };
}>;

/** Una asignación que impide retirar un área: dice a quién y en qué operativo. */
export interface AsignacionQueEstorba {
  identificador: string;
  area: AreaPersonal;
  persona: string;
}

/** Las columnas escalares de un formulario nuevo (las áreas/rol/prefijo van aparte). */
export interface DatosNuevoFormulario {
  numero: number;
  codigo: string;
  nombre: string;
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  rolDueno: RolDepartamental;
  politicaVehiculo: PoliticaVehiculo;
  condicionanteNoct: boolean;
  esPatrulla: boolean;
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  puntoManual: boolean;
  filtraPersonalPorRol: boolean;
  tipoControlMultiple: boolean;
  variosPorPersona: boolean;
  cantidadPorPersona: boolean;
  orden: number;
}

@Injectable()
export class FormulariosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos los formularios vigentes, en el orden de presentación del cuadro.
   *
   * Los dados de baja no se devuelven nunca: `FormularioRolGuard` tampoco los admite,
   * y ofrecer en la interfaz un formulario que la guarda rechazará al guardar es una
   * contradicción que el funcionario paga.
   */
  async listarActivos(): Promise<FormularioConAreas[]> {
    return this.prisma.formulario.findMany({
      where: { activo: true },
      include: { areas: true, roles: true },
      orderBy: { orden: 'asc' },
    });
  }

  async buscarPorCodigo(codigo: string): Promise<FormularioConAreas | null> {
    return this.prisma.formulario.findFirst({
      where: { codigo, activo: true },
      include: { areas: true, roles: true },
    });
  }

  /**
   * Prefijos de identificador del formulario. Agregado en M-14.
   *
   * `uq_formulario_prefijo_area` admite un prefijo por área, más uno sin área. El
   * predeterminado va primero para que quien elige no tenga que ordenarlos.
   */
  async prefijosDe(formularioId: number): Promise<FormularioPrefijo[]> {
    return this.prisma.formularioPrefijo.findMany({
      where: { formularioId },
      orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
    });
  }

  /** Comprueba qué identificadores de la lista existen. Para validar la delimitación. */
  async filtrarExistentes(formularioIds: number[]): Promise<number[]> {
    if (formularioIds.length === 0) return [];

    const filas = await this.prisma.formulario.findMany({
      where: { id: { in: formularioIds } },
      select: { id: true },
    });
    return filas.map((fila) => fila.id);
  }

  // ──────────────────── Escritura de áreas admitidas ────────────────────

  /**
   * Quién quedaría descolgado si se retiran esas áreas del formulario.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * SE MIRA LA JORNADA VIVA, NO EL HISTÓRICO. Un cuadro `CERRADO` ya se firmó y se
   * distribuyó: sus asignaciones son constancia de lo que ocurrió, y retirar un área hoy
   * no puede cambiar lo que pasó ayer. Lo que sí importa es la jornada que todavía se
   * está armando, porque ahí la asignación seguiría en pie mientras la regla que la
   * admitió deja de existir.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * Devuelve las asignaciones, no un booleano: el rechazo tiene que **nombrar** los
   * operativos afectados, que es lo que permite ir a arreglarlos.
   */
  async asignacionesEnAreas(
    formularioId: number,
    areas: AreaPersonal[],
  ): Promise<AsignacionQueEstorba[]> {
    if (areas.length === 0) return [];

    const filas = await this.prisma.asignacionPersonal.findMany({
      where: {
        funcionario: { area: { in: areas } },
        operativo: {
          formularioId,
          activo: true,
          cuadro: { estado: { not: EstadoCuadro.CERRADO } },
        },
      },
      select: {
        operativo: { select: { identificador: true } },
        funcionario: {
          select: { apellidos: true, nombres: true, area: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    return filas.map((fila) => ({
      identificador: fila.operativo.identificador,
      area: fila.funcionario.area,
      persona: `${fila.funcionario.apellidos} ${fila.funcionario.nombres}`,
    }));
  }

  /**
   * Deja el formulario con exactamente esas áreas.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * SE IGUALA EL CONJUNTO, NO SE OPERA FILA A FILA. Y `farea_es_compartida` SE CONSERVA.
   *
   * Borrar todas y volver a crearlas sería más corto y perdería la marca de compartida,
   * que es de donde un rol con acceso `APORTA` saca su personal (PER-06). En REACN eso
   * dejaría al DMIT sin poder asignar a nadie, con el mensaje «participa con personal de:
   * ninguna área», y el cambio parecería aplicado.
   *
   * Por eso se calcula la diferencia: se borran las que sobran y se crean las que
   * faltan. Las que siguen no se tocan, y conservan su marca.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async igualarAreas(
    formularioId: number,
    areas: AreaPersonal[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.formularioArea.deleteMany({
      where: { formularioId, area: { notIn: areas } },
    });

    await cliente.formularioArea.createMany({
      data: areas.map((area) => ({ formularioId, area })),
      skipDuplicates: true,
    });
  }

  // ──────────────── Alta y edición del formulario por pantalla (2026-09-29) ────────────────

  /**
   * Todos los formularios, INCLUIDOS los dados de baja, para la pantalla de administración.
   * A diferencia de `listarActivos`, aquí sí se ven los inactivos: la pantalla los muestra
   * apagados y con la acción de reactivar.
   */
  async listarTodos(): Promise<FormularioCompleto[]> {
    return this.prisma.formulario.findMany({
      include: { areas: true, prefijos: true },
      orderBy: { orden: 'asc' },
    });
  }

  /** Números y códigos ya usados (activos o no): la unicidad es sobre toda la tabla. */
  async numerosYCodigosUsados(): Promise<{ numero: number; codigo: string }[]> {
    return this.prisma.formulario.findMany({
      select: { numero: true, codigo: true },
    });
  }

  /** El formulario por su código SIN filtrar por activo: para editar uno dado de baja. */
  async buscarPorCodigoIncluidosInactivos(
    codigo: string,
  ): Promise<FormularioCompleto | null> {
    return this.prisma.formulario.findFirst({
      where: { codigo },
      include: { areas: true, prefijos: true },
    });
  }

  async crearFormulario(
    datos: DatosNuevoFormulario,
    cliente: Prisma.TransactionClient,
  ): Promise<FormularioConAreas> {
    return cliente.formulario.create({
      data: datos,
      include: { areas: true, roles: true },
    });
  }

  async actualizarFormulario(
    id: number,
    cambios: Prisma.FormularioUncheckedUpdateInput,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.formulario.update({ where: { id }, data: cambios });
  }

  /**
   * Deja al `rolNuevo` como ÚNICO rol con acceso ESCRITURA (el dueño). CONSERVA las filas
   * `APORTA` (los departamentos invitados, p. ej. la ECU): solo mueve la de ESCRITURA, para
   * que `reglas-formulario.ts`/`FormularioRolGuard` sigan viendo un único dueño.
   */
  async sincronizarRolDueno(
    formularioId: number,
    rolNuevo: RolDepartamental,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.formularioRol.deleteMany({
      where: { formularioId, acceso: AccesoFormulario.ESCRITURA },
    });
    await cliente.formularioRol.create({
      data: { formularioId, rol: rolNuevo, acceso: AccesoFormulario.ESCRITURA },
    });
  }

  /**
   * Fija el prefijo PREDETERMINADO del formulario (sin área, ordinario). Si ya existe lo
   * actualiza; si no, lo crea. En v1 el formulario lleva un único prefijo.
   */
  async fijarPrefijoPredeterminado(
    formularioId: number,
    prefijo: string,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    const existente = await cliente.formularioPrefijo.findFirst({
      where: { formularioId, esAdicional: false, areaAplica: null },
    });

    if (existente) {
      await cliente.formularioPrefijo.update({
        where: { id: existente.id },
        data: { prefijo, esPredeterminado: true },
      });
      return;
    }

    await cliente.formularioPrefijo.create({
      data: {
        formularioId,
        prefijo,
        esPredeterminado: true,
        esAdicional: false,
      },
    });
  }

  /** Cuántos operativos referencian el formulario. Para el aviso de la baja. */
  async contarOperativos(formularioId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { formularioId } });
  }

  /** Una transacción propia, para que el servicio escriba y audite en el mismo hueco. */
  async ejecutarEnTransaccion<T>(
    operacion: (cliente: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operacion);
  }
}
