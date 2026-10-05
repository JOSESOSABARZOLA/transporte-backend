/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos.service.ts
 * Responsabilidad: Publicar los catálogos de cada formulario y gobernar su administración.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * TRES REGLAS GOBIERNAN ESTE ARCHIVO.
 *
 * RN-16 · Cada formulario despliega SUS catálogos. Puntos, instituciones y tipos de
 * control PERTENECEN a un formulario (columna `form_id` propia, 2026-09-29); la consulta
 * filtra por él. Un formulario sin catálogos devuelve listas vacías; nunca el catálogo
 * de otro. Las zonales siguen siendo globales.
 *
 * RN-18 · Cada formulario ofrece las zonales donde tiene puntos. Revisada el 2026-09-02:
 * antes se ofrecian siempre las once. Ver `zonalesDeFormulario` en el repositorio.
 *
 * RF-058 e INV-22 · Un valor de catálogo NO SE ELIMINA. `eliminar` desactiva, y lo
 * hace siempre, esté o no usado en cuadros históricos. La alternativa —borrar cuando
 * nadie lo usa— exige acertar en la comprobación cada vez; desactivar siempre lo
 * garantiza por construcción. Las claves foráneas hacia el catálogo son `RESTRICT`,
 * de modo que un borrado físico fallaría en la base de todos modos.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type Institucion,
  type Prisma,
  type PuntoEncuentro,
  type TipoControl,
  type Zonal,
} from '@prisma/client';

import {
  AuditoriaService,
  type CambioCampo,
} from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  ReglaNegocioError,
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { normalizarParaComparar } from '../../../common/utilidades/texto';
import {
  CatalogosRepository,
  type CatalogosDelimitados,
} from '../infrastructure/catalogos.repository';
import { FormulariosService } from './formularios.service';

/** Catálogos de un formulario, con lo que la pantalla necesita para dibujarlos. */
export interface CatalogosDeFormulario extends CatalogosDelimitados {
  zonales: Zonal[];
  /** RN-20, por catálogo: ver `form_captura_libre_punto` y `form_captura_libre_tipo`. */
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  /** Si el formulario admite VARIOS tipos de control a la vez (los nueve desde 2026-09-14). */
  tipoControlMultiple: boolean;
  /** Si cada persona asignada genera su propio operativo —el split— (el 8 y el 5). */
  variosPorPersona: boolean;
  /** Si el formulario OFRECE fijar la cantidad de operativos por persona (> 1). Solo el 8. */
  cantidadPorPersona: boolean;
  /** Si al registrar se puede AGREGAR un punto al catálogo (Unidad de Operativos, 1-4). */
  puntoManual: boolean;
}

/** Resultado de una baja lógica, con el motivo que se le muestra al administrador. */
export interface ResultadoBaja<T> {
  registro: T;
  usosHistoricos: number;
  mensaje: string;
}

@Injectable()
export class CatalogosService {
  constructor(
    private readonly repositorio: CatalogosRepository,
    private readonly formularios: FormulariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  /**
   * La lista de ADMINISTRACION; para registrar se usa la del formulario.
   *
   * `incluirInactivas` solo lo pide la pantalla de catálogos, que necesita ver las
   * desactivadas para poder reactivarlas. Por omisión salen solo las vigentes.
   */
  async listarZonales(incluirInactivas = false): Promise<Zonal[]> {
    return this.repositorio.listarZonales(incluirInactivas);
  }

  async obtenerCatalogos(codigo: string): Promise<CatalogosDeFormulario> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);

    // Cada formulario maneja sus zonales, no las once. Ver `zonalesDeFormulario`.
    const [delimitados, zonales] = await Promise.all([
      this.repositorio.catalogosDeFormulario(formulario.id),
      this.repositorio.zonalesDeFormulario(formulario.id),
    ]);

    return {
      ...delimitados,
      zonales,
      capturaLibrePunto: formulario.capturaLibrePunto,
      capturaLibreTipo: formulario.capturaLibreTipo,
      tipoControlMultiple: formulario.tipoControlMultiple,
      variosPorPersona: formulario.variosPorPersona,
      cantidadPorPersona: formulario.cantidadPorPersona,
      puntoManual: formulario.puntoManual,
    };
  }

  /**
   * PV-36. Los catálogos del formulario PARA ADMINISTRAR: incluye los desactivados, con
   * su bandera `activo`, para poder reactivarlos. El registro de operativos no usa esto
   * —usa `obtenerCatalogos`, que filtra lo vigente—; este camino es solo de P-08.
   */
  async obtenerCatalogosAdmin(codigo: string): Promise<CatalogosDeFormulario> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);

    const [delimitados, zonales] = await Promise.all([
      this.repositorio.catalogosDeFormularioConInactivos(formulario.id),
      this.repositorio.zonalesDeFormulario(formulario.id),
    ]);

    return {
      ...delimitados,
      zonales,
      capturaLibrePunto: formulario.capturaLibrePunto,
      capturaLibreTipo: formulario.capturaLibreTipo,
      tipoControlMultiple: formulario.tipoControlMultiple,
      variosPorPersona: formulario.variosPorPersona,
      cantidadPorPersona: formulario.cantidadPorPersona,
      puntoManual: formulario.puntoManual,
    };
  }

  /** RN-17. Los puntos del formulario que pertenecen a la zonal indicada. */
  async obtenerPuntos(
    codigo: string,
    zonalId: number,
  ): Promise<PuntoEncuentro[]> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    await this.exigirZonal(zonalId);

    return this.repositorio.puntosDeFormularioYZonal(formulario.id, zonalId);
  }

  // ─────────────────── Administración · puntos ───────────────────

  async crearPunto(
    datos: { nombre: string; zonalId: number; formularioId: number },
    usuarioId: number,
  ): Promise<PuntoEncuentro> {
    const nombre = datos.nombre.trim();
    await this.exigirZonal(datos.zonalId);
    // Cada punto pertenece a UN formulario (2026-09-29): ya no se delimita a una lista.
    await this.exigirFormulariosExistentes([datos.formularioId]);

    const existentes = await this.repositorio.nombresDePuntosDeFormularioYZonal(
      datos.formularioId,
      datos.zonalId,
    );
    this.exigirDenominacionLibre(
      nombre,
      existentes.map((fila) => fila.nombre),
      'punto de encuentro',
    );

    return this.escribirConTraza(
      't_punto_encuentro',
      AccionAuditoria.CREAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.crearPunto(
          { nombre, zonalId: datos.zonalId, formularioId: datos.formularioId },
          cliente,
        ),
    );
  }

  /**
   * VALIDA un punto NUEVO que se va a crear al REGISTRAR un operativo (Unidad de Operativos,
   * 2026-09-24), ANTES de abrir la transacción del registro. Comprueba lo que no depende de
   * escribir: que el formulario lo permita (`puntoManual`, hoy los de Unidad de Operativos 1-4),
   * que la zonal exista y que el nombre esté libre en esa zonal. Devuelve el nombre ya recortado.
   *
   * NO crea nada: el punto se escribe con `crearPuntoEnTransaccion`, DENTRO de la transacción del
   * operativo, para que entren juntos o no entre ninguno (regla 5). Si el operativo se rechaza, el
   * punto tampoco queda —que es justo lo que pidió Unidad de Operativos—.
   */
  async validarPuntoDeRegistro(
    codigoFormulario: string,
    datos: { nombre: string; zonalId: number },
  ): Promise<string> {
    const formulario =
      await this.formularios.obtenerDefinicion(codigoFormulario);
    if (!formulario.puntoManual) {
      throw new ValidacionError(
        'Este formulario no permite agregar puntos de encuentro al registrar.',
        { formulario: codigoFormulario },
      );
    }

    await this.exigirZonal(datos.zonalId);

    const nombre = datos.nombre.trim();
    const existentes = await this.repositorio.nombresDePuntosDeFormularioYZonal(
      formulario.id,
      datos.zonalId,
    );
    this.exigirDenominacionLibre(
      nombre,
      existentes.map((fila) => fila.nombre),
      'punto de encuentro',
    );

    return nombre;
  }

  /**
   * CREA el punto NUEVO del registro DENTRO de una transacción ajena (la del operativo), con el
   * `cliente` recibido: lo inserta, lo vincula a ESTE formulario y deja su traza, todo en esa
   * misma transacción. Lo que valida —zonal, formulario, nombre libre— ya se comprobó en
   * `validarPuntoDeRegistro` antes de abrir la transacción; aquí solo se escribe. Ver
   * `OperativosService.registrar`.
   */
  async crearPuntoEnTransaccion(
    cliente: Prisma.TransactionClient,
    datos: { nombre: string; zonalId: number; formularioId: number },
    usuarioId: number,
  ): Promise<PuntoEncuentro> {
    const punto = await this.repositorio.crearPunto(
      {
        nombre: datos.nombre.trim(),
        zonalId: datos.zonalId,
        formularioId: datos.formularioId,
      },
      cliente,
    );
    await this.auditoria.registrar(
      {
        entidad: 't_punto_encuentro',
        entidadId: punto.id,
        accion: AccionAuditoria.CREAR,
        usuario: usuarioId,
      },
      cliente,
    );
    return punto;
  }

  async actualizarPunto(
    id: number,
    datos: {
      nombre?: string;
      zonalId?: number;
      activo?: boolean;
    },
    usuarioId: number,
  ): Promise<PuntoEncuentro> {
    const punto = await this.exigirPunto(id);
    const nombre = datos.nombre?.trim();
    const zonalId = datos.zonalId ?? punto.zonalId;

    if (datos.zonalId !== undefined) await this.exigirZonal(datos.zonalId);

    // UN PUNTO NO SE REACTIVA BAJO UNA ZONAL INACTIVA. La baja de la zonal arrastró la del
    // punto; devolverlo mientras su zonal sigue desactivada lo dejaría vigente en una zonal
    // que no se ofrece al registrar. Primero se reactiva la zonal —y desde entonces sus
    // puntos se reactivan uno a uno—. Se comprueba solo al REACTIVAR: renombrar o mover de
    // zonal un punto ya inactivo sigue permitido.
    if (datos.activo === true && !punto.activo) {
      const zonal = await this.exigirZonal(zonalId);
      if (!zonal.activo) {
        throw new ValidacionError(
          `«${punto.nombre}» pertenece a una zonal desactivada. Reactive primero la zonal «${zonal.nombre}» para poder reactivar sus puntos.`,
          { puntoId: id, zonalId },
        );
      }
    }

    // La comprobación se hace si cambia el nombre O LA ZONAL. `uq_punto_form_zona_nombre`
    // es compuesto: mover un punto a otra zonal donde SU formulario ya tiene esa denominación
    // infringe la restricción igual que renombrarlo, y sin esta rama el fallo llegaba
    // desde la base como error no controlado. El formulario del punto es inmutable.
    const cambiaDenominacion = nombre !== undefined && nombre !== punto.nombre;
    const cambiaZonal = zonalId !== punto.zonalId;

    if (cambiaDenominacion || cambiaZonal) {
      const existentes =
        await this.repositorio.nombresDePuntosDeFormularioYZonal(
          punto.formularioId,
          zonalId,
        );
      this.exigirDenominacionLibre(
        nombre ?? punto.nombre,
        existentes.filter((fila) => fila.id !== id).map((fila) => fila.nombre),
        'punto de encuentro',
      );
    }

    // Las claves son NOMBRES DE COLUMNA, no propiedades del modelo: la traza la lee
    // quien investiga un cambio en la base, y una auditoría que unas veces dice
    // `nombre` y otras `pcto_activo` obliga a traducir mentalmente en cada consulta.
    const cambios = this.auditoria.compararCambios(
      {
        pcto_nombre: punto.nombre,
        zona_id: punto.zonalId,
        pcto_activo: punto.activo,
      },
      {
        pcto_nombre: nombre ?? punto.nombre,
        zona_id: zonalId,
        pcto_activo: datos.activo ?? punto.activo,
      },
    );
    if (cambios.length === 0) return punto;

    return this.escribirConTraza(
      't_punto_encuentro',
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.actualizarPunto(
          id,
          { nombre, zonalId: datos.zonalId, activo: datos.activo },
          cliente,
        ),
      cambios,
    );
  }

  async desactivarPunto(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<PuntoEncuentro>> {
    return this.darDeBaja(usuarioId, {
      entidad: 't_punto_encuentro',
      campoActivo: 'pcto_activo',
      buscar: () => this.exigirPunto(id),
      denominacion: (punto) => punto.nombre,
      contarUsos: () => this.repositorio.contarOperativosConPunto(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarPunto(id, { activo: false }, cliente),
    });
  }

  // ─────────────────── Administración · zonales ───────────────────
  //
  // La zonal dejó de ser un catálogo cerrado el 2026-09-04. Antes eran las once filas del
  // Distrito y no había forma de sumar una; ahora el administrador puede crear, renombrar
  // y desactivar, con el mismo blindaje que los otros catálogos: nombre único, baja lógica
  // y traza. El CÓDIGO no lo teclea nadie: se deriva del nombre y se garantiza único.

  async crearZonal(
    datos: { nombre: string },
    usuarioId: number,
  ): Promise<Zonal> {
    const nombre = datos.nombre.trim();

    const existentes = await this.repositorio.nombresDeZonales();
    this.exigirDenominacionLibre(
      nombre,
      existentes.map((fila) => fila.nombre),
      'zonal',
    );

    const codigo = await this.generarCodigoZonal(nombre);
    const orden = (await this.repositorio.maxOrdenZonal()) + 1;

    return this.escribirConTraza(
      't_zonal',
      AccionAuditoria.CREAR,
      usuarioId,
      (cliente) =>
        // Una zonal nueva es administrativa, no el ámbito distrital: `esDmq` es siempre
        // falso —el DMQ es único y ya existe— y nace vigente.
        this.repositorio.crearZonal(
          { codigo, nombre, orden, esDmq: false },
          cliente,
        ),
    );
  }

  async actualizarZonal(
    id: number,
    datos: { nombre?: string; activo?: boolean },
    usuarioId: number,
  ): Promise<Zonal> {
    const zonal = await this.exigirZonal(id);
    const nombre = datos.nombre?.trim();

    // El código NO se toca al actualizar: lo referencian los operativos y otras capas, y
    // cambiarlo en uso rompería esas referencias. Solo cambian nombre y estado.
    const cambiaDenominacion = nombre !== undefined && nombre !== zonal.nombre;
    if (cambiaDenominacion) {
      const existentes = await this.repositorio.nombresDeZonales();
      this.exigirDenominacionLibre(
        nombre,
        existentes.filter((fila) => fila.id !== id).map((fila) => fila.nombre),
        'zonal',
      );
    }

    const cambios = this.auditoria.compararCambios(
      { zona_nombre: zonal.nombre, zona_activo: zonal.activo },
      {
        zona_nombre: nombre ?? zonal.nombre,
        zona_activo: datos.activo ?? zonal.activo,
      },
    );
    if (cambios.length === 0) return zonal;

    return this.escribirConTraza(
      't_zonal',
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      (cliente) =>
        this.repositorio.actualizarZonal(
          id,
          { nombre, activo: datos.activo },
          cliente,
        ),
      cambios,
    );
  }

  /**
   * Da de baja la zonal Y, EN CASCADA, SUS PUNTOS DE ENCUENTRO VIGENTES.
   *
   * Una zonal fuera de uso no debe dejar puntos vigentes colgando: al registrar ya no se
   * ofrece la zonal, pero si se reactivara reaparecerían sus puntos como si nada, y en la
   * administración se verían activos bajo una zonal inactiva. Se desactivan con ella.
   *
   * NO SE USA `darDeBaja` porque esto toca dos tablas y **todo va en una sola transacción**
   * (regla 5), con la traza de la zonal y la de cada punto dentro. La reactivación NO es
   * simétrica a propósito: reactivar la zonal no reactiva sus puntos —cada uno pudo
   * retirarse por su cuenta—, así que se reactivan uno a uno.
   */
  async desactivarZonal(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<Zonal>> {
    const zonal = await this.exigirZonal(id);
    const usos = await this.repositorio.contarOperativosConZonal(id);

    // Una baja repetida no escribe ni audita: la traza diría que no cambió nada.
    if (!zonal.activo) {
      return {
        registro: zonal,
        usosHistoricos: usos,
        mensaje: `${zonal.nombre} ya estaba fuera de uso. No se modificó nada.`,
      };
    }

    const puntos = await this.repositorio.puntosActivosDeZonal(id);

    const desactivada = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const fila = await this.repositorio.actualizarZonal(
          id,
          { activo: false },
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_zonal',
            entidadId: id,
            accion: AccionAuditoria.ELIMINAR,
            cambios: [
              {
                campo: 'zona_activo',
                valorAnterior: 'true',
                valorNuevo: 'false',
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );

        for (const punto of puntos) {
          await this.repositorio.actualizarPunto(
            punto.id,
            { activo: false },
            cliente,
          );
          await this.auditoria.registrar(
            {
              entidad: 't_punto_encuentro',
              entidadId: punto.id,
              accion: AccionAuditoria.ELIMINAR,
              cambios: [
                {
                  campo: 'pcto_activo',
                  valorAnterior: 'true',
                  valorNuevo: 'false',
                },
              ],
              usuario: usuarioId,
            },
            cliente,
          );
        }

        return fila;
      },
    );

    const cascada =
      puntos.length === 0
        ? ''
        : ` Se desactivaron también ${puntos.length} punto${puntos.length === 1 ? '' : 's'} de encuentro de la zonal.`;

    return {
      registro: desactivada,
      usosHistoricos: usos,
      mensaje: this.mensajeDeBaja(zonal.nombre, usos) + cascada,
    };
  }

  /**
   * Deriva el código de una zonal de su nombre y lo garantiza único.
   *
   * MAYÚSCULAS, SIN TILDES, CON GUION BAJO: la forma de los códigos que ya existen
   * (`EUGENIO_ESPEJO`). Se acota a 30 caracteres —el ancho de `zona_codigo`— y, si dos
   * nombres producen el mismo código, se desempata con un sufijo numérico. Autogenerarlo
   * en vez de pedirlo evita duplicados y códigos escritos de cualquier manera.
   */
  private async generarCodigoZonal(nombre: string): Promise<string> {
    const base = nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);

    const usados = new Set(await this.repositorio.codigosDeZonales());
    if (base !== '' && !usados.has(base)) return base;

    const raiz = base === '' ? 'ZONAL' : base;
    for (let i = 2; i < 1000; i += 1) {
      const sufijo = `_${i}`;
      const candidato = `${raiz.slice(0, 30 - sufijo.length)}${sufijo}`;
      if (!usados.has(candidato)) return candidato;
    }

    throw new ValidacionError(
      'No se pudo generar un código único para la zonal. Cambie el nombre.',
      { nombre },
    );
  }

  // ───────────── Administración · tipos de control ─────────────

  async crearTipoControl(
    datos: { nombre: string; formularioId: number },
    usuarioId: number,
  ): Promise<TipoControl> {
    const nombre = datos.nombre.trim();
    // Cada tipo pertenece a UN formulario (2026-09-07): ya no se delimita a una lista.
    await this.exigirFormulariosExistentes([datos.formularioId]);

    const existentes = await this.repositorio.nombresDeTiposControlDeFormulario(
      datos.formularioId,
    );
    this.exigirDenominacionLibre(
      nombre,
      existentes.map((fila) => fila.nombre),
      'tipo de control',
    );

    return this.escribirConTraza(
      't_tipo_control',
      AccionAuditoria.CREAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.crearTipoControl(nombre, datos.formularioId, cliente),
    );
  }

  async actualizarTipoControl(
    id: number,
    datos: { nombre?: string; activo?: boolean },
    usuarioId: number,
  ): Promise<TipoControl> {
    const tipo = await this.exigirTipoControl(id);
    const nombre = datos.nombre?.trim();

    if (nombre !== undefined && nombre !== tipo.nombre) {
      // El nombre es único DENTRO del formulario del tipo, no en todo el catálogo.
      const existentes =
        await this.repositorio.nombresDeTiposControlDeFormulario(
          tipo.formularioId,
        );
      this.exigirDenominacionLibre(
        nombre,
        existentes.filter((fila) => fila.id !== id).map((fila) => fila.nombre),
        'tipo de control',
      );
    }

    const cambios = this.auditoria.compararCambios(
      { tico_nombre: tipo.nombre, tico_activo: tipo.activo },
      {
        tico_nombre: nombre ?? tipo.nombre,
        tico_activo: datos.activo ?? tipo.activo,
      },
    );
    if (cambios.length === 0) return tipo;

    return this.escribirConTraza(
      't_tipo_control',
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.actualizarTipoControl(
          id,
          { nombre, activo: datos.activo },
          cliente,
        ),
      cambios,
    );
  }

  async desactivarTipoControl(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<TipoControl>> {
    return this.darDeBaja(usuarioId, {
      entidad: 't_tipo_control',
      campoActivo: 'tico_activo',
      buscar: () => this.exigirTipoControl(id),
      denominacion: (tipo) => tipo.nombre,
      contarUsos: () => this.repositorio.contarOperativosConTipoControl(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarTipoControl(id, { activo: false }, cliente),
    });
  }

  // ─────────────── Administración · instituciones ───────────────

  async crearInstitucion(
    datos: { sigla: string; nombre: string; formularioId: number },
    usuarioId: number,
  ): Promise<Institucion> {
    const sigla = datos.sigla.trim();
    const nombre = datos.nombre.trim();
    // Cada institución pertenece a UN formulario (2026-09-29): ya no se delimita a una lista.
    await this.exigirFormulariosExistentes([datos.formularioId]);

    const existentes = await this.repositorio.siglasDeInstitucionesDeFormulario(
      datos.formularioId,
    );
    this.exigirDenominacionLibre(
      sigla,
      existentes.map((fila) => fila.sigla),
      'institución',
    );

    return this.escribirConTraza(
      't_institucion',
      AccionAuditoria.CREAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.crearInstitucion(
          { sigla, nombre, formularioId: datos.formularioId },
          cliente,
        ),
    );
  }

  async actualizarInstitucion(
    id: number,
    datos: {
      sigla?: string;
      nombre?: string;
      activo?: boolean;
    },
    usuarioId: number,
  ): Promise<Institucion> {
    const institucion = await this.exigirInstitucion(id);
    const sigla = datos.sigla?.trim();
    const nombre = datos.nombre?.trim();

    // La sigla es unica por formulario (2026-09-29): se compara solo con las del mismo.
    if (sigla !== undefined && sigla !== institucion.sigla) {
      const existentes =
        await this.repositorio.siglasDeInstitucionesDeFormulario(
          institucion.formularioId,
        );
      this.exigirDenominacionLibre(
        sigla,
        existentes.filter((fila) => fila.id !== id).map((fila) => fila.sigla),
        'institución',
      );
    }

    const cambios = this.auditoria.compararCambios(
      {
        inst_sigla: institucion.sigla,
        inst_nombre: institucion.nombre,
        inst_activo: institucion.activo,
      },
      {
        inst_sigla: sigla ?? institucion.sigla,
        inst_nombre: nombre ?? institucion.nombre,
        inst_activo: datos.activo ?? institucion.activo,
      },
    );
    if (cambios.length === 0) return institucion;

    return this.escribirConTraza(
      't_institucion',
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      async (cliente) =>
        this.repositorio.actualizarInstitucion(
          id,
          { sigla, nombre, activo: datos.activo },
          cliente,
        ),
      cambios,
    );
  }

  async desactivarInstitucion(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<Institucion>> {
    return this.darDeBaja(usuarioId, {
      entidad: 't_institucion',
      campoActivo: 'inst_activo',
      buscar: () => this.exigirInstitucion(id),
      denominacion: (institucion) => institucion.sigla,
      contarUsos: () => this.repositorio.contarOperativosConInstitucion(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarInstitucion(id, { activo: false }, cliente),
    });
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * Escribe y audita en la misma transacción (DA-09).
   *
   * Concentra aquí lo que las nueve operaciones de administración comparten: abrir la
   * transacción, dejar la traza con el identificador que la operación produjo —que en
   * un alta solo se conoce después de insertar— y devolver la fila.
   */
  private async escribirConTraza<T extends { id: number }>(
    entidad: string,
    accion: AccionAuditoria,
    usuarioId: number,
    operacion: (cliente: Prisma.TransactionClient) => Promise<T>,
    cambios?: CambioCampo[],
  ): Promise<T> {
    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const fila = await operacion(cliente);

      await this.auditoria.registrar(
        {
          entidad,
          entidadId: fila.id,
          accion,
          cambios,
          usuario: usuarioId,
        },
        cliente,
      );

      return fila;
    });
  }

  /**
   * Baja lógica de un valor de catálogo (RF-058 e INV-22).
   *
   * Los tres catálogos se dan de baja igual y solo cambian en cuatro datos: la tabla,
   * la columna de estado, cómo se busca el registro y de dónde sale su denominación.
   * Estaban escritos tres veces, con la diferencia de que cada copia podía divergir en
   * el mensaje o en el orden de las comprobaciones.
   */
  private async darDeBaja<T extends { id: number; activo: boolean }>(
    usuarioId: number,
    catalogo: {
      entidad: string;
      campoActivo: string;
      buscar: () => Promise<T>;
      denominacion: (registro: T) => string;
      contarUsos: () => Promise<number>;
      desactivar: (cliente: Prisma.TransactionClient) => Promise<T>;
    },
  ): Promise<ResultadoBaja<T>> {
    const registro = await catalogo.buscar();
    const usos = await catalogo.contarUsos();
    const denominacion = catalogo.denominacion(registro);

    // Una baja repetida no escribe ni audita: la traza diría que no cambió nada.
    if (!registro.activo) {
      return {
        registro,
        usosHistoricos: usos,
        mensaje: `${denominacion} ya estaba fuera de uso. No se modificó nada.`,
      };
    }

    const desactivado = await this.escribirConTraza(
      catalogo.entidad,
      AccionAuditoria.ELIMINAR,
      usuarioId,
      catalogo.desactivar,
      [
        {
          campo: catalogo.campoActivo,
          valorAnterior: 'true',
          valorNuevo: 'false',
        },
      ],
    );

    return {
      registro: desactivado,
      usosHistoricos: usos,
      mensaje: this.mensajeDeBaja(denominacion, usos),
    };
  }

  private mensajeDeBaja(denominacion: string, usos: number): string {
    if (usos === 0) {
      return `${denominacion} se retiró del catálogo. Los valores de catálogo no se eliminan: se conservan para que los cuadros anteriores sigan siendo legibles.`;
    }
    return `${denominacion} se retiró del catálogo y ya no se ofrecerá al registrar. No se elimina porque está registrado en ${usos} operativo${usos === 1 ? '' : 's'} anterior${usos === 1 ? '' : 'es'}.`;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * BAJA FÍSICA (ELIMINAR), y SOLO para lo que NUNCA se usó. 2026-09-24.
   *
   * A diferencia de la baja lógica (desactivar), esto BORRA la fila. Solo se permite si el
   * valor no está registrado en ningún operativo: las FK hacia el catálogo son `RESTRICT`
   * (INV-22), así que borrar lo usado corrompería el historial y además fallaría en la base.
   * Cuando está en uso se responde 409 con el motivo, y el administrador desactiva en su lugar.
   * Una zonal con puntos tampoco se borra: primero hay que eliminar/mover sus puntos.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async eliminarZonal(
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_zonal',
      buscar: () => this.exigirZonal(id),
      denominacion: (zonal: Zonal) => zonal.nombre,
      contarUsos: () => this.repositorio.contarOperativosConZonal(id),
      bloqueoExtra: async () => {
        // Cuenta TODOS los puntos de la zonal, de cualquier formulario y aunque estén
        // desactivados: la zonal es global y la FK del punto es RESTRICT. Por eso una zonal
        // que en ESTE formulario se ve con «0 puntos» puede tenerlos en otro y no borrarse.
        const puntos = await this.repositorio.contarPuntosDeZonal(id);
        return puntos > 0
          ? `No se puede eliminar la zonal: todavía tiene ${puntos} punto${puntos === 1 ? '' : 's'} de encuentro asociado${puntos === 1 ? '' : 's'}, contando los de TODOS los formularios y los desactivados. Elimine primero esos puntos.`
          : null;
      },
      eliminar: (cliente) => this.repositorio.eliminarZonal(id, cliente),
    });
  }

  async eliminarPunto(
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_punto_encuentro',
      buscar: () => this.exigirPunto(id),
      denominacion: (punto: PuntoEncuentro) => punto.nombre,
      contarUsos: () => this.repositorio.contarOperativosConPunto(id),
      eliminar: (cliente) => this.repositorio.eliminarPunto(id, cliente),
    });
  }

  async eliminarTipoControl(
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_tipo_control',
      buscar: () => this.exigirTipoControl(id),
      denominacion: (tipo: TipoControl) => tipo.nombre,
      contarUsos: () => this.repositorio.contarOperativosConTipoControl(id),
      eliminar: (cliente) => this.repositorio.eliminarTipoControl(id, cliente),
    });
  }

  async eliminarInstitucion(
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_institucion',
      buscar: () => this.exigirInstitucion(id),
      denominacion: (institucion: Institucion) => institucion.sigla,
      contarUsos: () => this.repositorio.contarOperativosConInstitucion(id),
      eliminar: (cliente) => this.repositorio.eliminarInstitucion(id, cliente),
    });
  }

  /** El borrado físico compartido por los cuatro catálogos. Ver la nota de arriba. */
  private async eliminarPermanente<T extends { id: number }>(
    usuarioId: number,
    catalogo: {
      entidad: string;
      buscar: () => Promise<T>;
      denominacion: (registro: T) => string;
      contarUsos: () => Promise<number>;
      bloqueoExtra?: () => Promise<string | null>;
      eliminar: (cliente: Prisma.TransactionClient) => Promise<void>;
    },
  ): Promise<{ id: number; mensaje: string }> {
    const registro = await catalogo.buscar();
    const denominacion = catalogo.denominacion(registro);

    const usos = await catalogo.contarUsos();
    if (usos > 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CATALOGO_EN_USO,
        `No se puede eliminar ${denominacion}: está registrado en ${usos} operativo${usos === 1 ? '' : 's'} anterior${usos === 1 ? '' : 'es'}. Desactívelo en su lugar para conservar el historial.`,
        { id: registro.id, usos },
      );
    }

    if (catalogo.bloqueoExtra) {
      const motivo = await catalogo.bloqueoExtra();
      if (motivo) {
        throw new ReglaNegocioError(CODIGOS_ERROR.CATALOGO_EN_USO, motivo, {
          id: registro.id,
        });
      }
    }

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await catalogo.eliminar(cliente);
      await this.auditoria.registrar(
        {
          entidad: catalogo.entidad,
          entidadId: registro.id,
          accion: AccionAuditoria.ELIMINAR,
          cambios: [
            {
              campo: 'eliminado',
              valorAnterior: denominacion,
              valorNuevo: '(borrado definitivo)',
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
    });

    return {
      id: registro.id,
      mensaje: `${denominacion} se eliminó definitivamente del catálogo.`,
    };
  }

  /**
   * Impide dos escrituras de la misma cosa.
   *
   * La unicidad de la base distingue mayúsculas y acentos, de modo que «Control de
   * ruido» y «CONTROL DE RUIDO» conviven como filas distintas del mismo catálogo. La
   * semilla de M-03 detecta esos casos en los datos de origen pero no puede impedir
   * los nuevos; esta comprobación sí. Ver M07_FORMULARIOS_CATALOGOS.md §5.
   */
  private exigirDenominacionLibre(
    denominacion: string,
    existentes: string[],
    catalogo: string,
  ): void {
    const canonica = normalizarParaComparar(denominacion);
    const choque = existentes.find(
      (valor) => normalizarParaComparar(valor) === canonica,
    );

    if (choque) {
      throw new ValidacionError(
        `Ya existe un ${catalogo} registrado como «${choque}». Los catálogos no distinguen mayúsculas ni acentos: use el valor existente o cámbiele el nombre a ese.`,
        { denominacionPropuesta: denominacion, denominacionExistente: choque },
      );
    }
  }

  private async exigirZonal(zonalId: number): Promise<Zonal> {
    const zonal = await this.repositorio.buscarZonal(zonalId);
    if (!zonal) {
      throw new RecursoNoEncontradoError(
        `No existe la zonal con identificador ${zonalId}.`,
        { zonalId },
      );
    }
    return zonal;
  }

  private async exigirPunto(id: number): Promise<PuntoEncuentro> {
    const punto = await this.repositorio.buscarPunto(id);
    if (!punto) {
      throw new RecursoNoEncontradoError(
        `No existe el punto de encuentro con identificador ${id}.`,
        { id },
      );
    }
    return punto;
  }

  private async exigirTipoControl(id: number): Promise<TipoControl> {
    const tipo = await this.repositorio.buscarTipoControl(id);
    if (!tipo) {
      throw new RecursoNoEncontradoError(
        `No existe el tipo de control con identificador ${id}.`,
        { id },
      );
    }
    return tipo;
  }

  private async exigirInstitucion(id: number): Promise<Institucion> {
    const institucion = await this.repositorio.buscarInstitucion(id);
    if (!institucion) {
      throw new RecursoNoEncontradoError(
        `No existe la institución con identificador ${id}.`,
        { id },
      );
    }
    return institucion;
  }

  private async exigirFormulariosExistentes(
    formularioIds: number[] | undefined,
  ): Promise<void> {
    if (!formularioIds || formularioIds.length === 0) return;

    const inexistentes = await this.formularios.verificarExisten(formularioIds);
    if (inexistentes.length > 0) {
      throw new ValidacionError(
        `No existen los formularios con identificador ${inexistentes.join(', ')}.`,
        { formulariosInexistentes: inexistentes },
      );
    }
  }
}
