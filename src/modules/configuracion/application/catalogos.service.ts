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
 * RN-16 · Cada formulario despliega SUS catálogos, y SOLO los suyos. Puntos, instituciones y
 * tipos de control PERTENECEN a un formulario (columna `form_id` propia, 2026-09-29), y desde el
 * 2026-10-13 también las ZONALES (`t_zonal_formulario`). Nada se comparte, copia ni vincula entre
 * formularios: un cambio en uno nunca afecta a otro. Por eso TODA operación de administración
 * recibe el formulario y rechaza con 404 un valor que no es suyo.
 *
 * RN-18 · Al registrar, cada formulario ofrece sus zonales vigentes que tienen puntos. Ver
 * `zonalesDeFormulario` en el repositorio.
 *
 * RF-058 e INV-22 · Un valor de catálogo USADO no se elimina: se desactiva, y los cuadros
 * anteriores lo siguen leyendo. Lo que NUNCA se usó sí se borra de verdad (`eliminar*`), con la
 * política pura `politicas/eliminacion-catalogo.ts` que usan la lista —para habilitar el botón— y
 * el borrado —para el 409—.
 *
 * LA ZONA DE LA CIUDAD (`t_zonal`) NO SE ADMINISTRA AQUÍ. La usan la ficha de personal, la flota,
 * los traslados y Transporte, que reconocen el mismo sitio entre formularios. Esta pantalla crea,
 * renombra, desactiva y borra la zonal DEL formulario; la zona solo se elige al darla de alta.
 * «Disponible en los formularios» (copias, 2026-10-12) se retiró el 2026-10-13 por la misma regla.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type Institucion,
  type Prisma,
  type PuntoEncuentro,
  type TipoControl,
  type TipoTransporte,
  type Zonal,
  type ZonalFormulario,
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
import {
  aFormatoTitulo,
  enMayusculas,
  normalizarParaComparar,
} from '../../../common/utilidades/texto';
import type { FormularioConAreas } from '../infrastructure/formularios.repository';
import {
  CatalogosRepository,
  comoZonal,
  type CatalogosDelimitados,
  type PuntoConZonal,
  type ZonalDeFormulario,
} from '../infrastructure/catalogos.repository';
import { FormulariosService } from './formularios.service';
import {
  puedeEliminar,
  type UsoDeCatalogo,
  type VeredictoEliminacion,
} from './politicas/eliminacion-catalogo';

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
  /** Tipo de transporte que toma el operativo si el registro no lo indica (2026-10-07). */
  tipoTransportePorDefecto: TipoTransporte;
}

/** Resultado de una baja lógica, con el motivo que se le muestra al administrador. */
export interface ResultadoBaja<T> {
  registro: T;
  usosHistoricos: number;
  mensaje: string;
}

/**
 * Lo que la lista de ADMINISTRACIÓN añade a cada valor: cuántos operativos lo usan y si se puede
 * borrar, con la misma política que el borrado.
 */
export interface DatosDeAdministracion extends VeredictoEliminacion {
  usos: number;
}

export interface CatalogosAdminDeFormulario extends Omit<
  CatalogosDeFormulario,
  'puntos' | 'tiposControl' | 'instituciones'
> {
  puntos: (PuntoConZonal & DatosDeAdministracion)[];
  tiposControl: (TipoControl & DatosDeAdministracion)[];
  instituciones: (Institucion & DatosDeAdministracion)[];
}

/**
 * Una zonal DEL FORMULARIO para administrar. Se identifica por su ZONA (`id`), que es única en el
 * formulario y es la que llevan sus puntos; `zonalFormularioId` es la fila propia.
 */
export interface ZonalAdmin extends Zonal, VeredictoEliminacion {
  zonalFormularioId: number;
  /** Operativos de ESTE formulario que la llevan. */
  usos: number;
  /** Puntos de ESTE formulario en la zonal, activos o no. */
  puntos: number;
  /** De esos, los vigentes. */
  puntosActivos: number;
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
   * Las ZONAS DE LA CIUDAD (`GET /zonales`), para la ficha de personal, la cobertura, la flota y el
   * mantenimiento. No es la lista de un formulario: para eso están `obtenerCatalogos` y
   * `listarZonalesAdmin`.
   */
  async listarZonales(incluirInactivas = false): Promise<Zonal[]> {
    return this.repositorio.listarZonales(incluirInactivas);
  }

  /**
   * Las zonales DEL FORMULARIO para administrar, con las desactivadas, sus puntos y sus usos en
   * ese formulario, y si se pueden borrar. Tres consultas fijas, ninguna por fila.
   */
  async listarZonalesAdmin(codigo: string): Promise<ZonalAdmin[]> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const [zonales, operativos, puntos] = await Promise.all([
      this.repositorio.zonalesDelFormulario(formulario.id),
      this.repositorio.operativosPorZonaDeFormulario(formulario.id),
      this.repositorio.puntosPorZonaDeFormulario(formulario.id),
    ]);

    return zonales.map((fila) => {
      const uso = {
        usos: operativos.get(fila.zonaId) ?? 0,
        puntos: puntos.todos.get(fila.zonaId) ?? 0,
      };
      return {
        ...this.comoZonalAdmin(fila),
        usos: uso.usos,
        puntos: uso.puntos,
        puntosActivos: puntos.activos.get(fila.zonaId) ?? 0,
        ...puedeEliminar(uso),
      };
    });
  }

  /** Las zonas de la ciudad vigentes que el formulario aún no tiene: lo que ofrece el alta. */
  async zonasDisponibles(codigo: string): Promise<Zonal[]> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.repositorio.zonasDisponibles(formulario.id);
  }

  async obtenerCatalogos(codigo: string): Promise<CatalogosDeFormulario> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);

    // Cada formulario maneja sus zonales, no las de la ciudad. Ver `zonalesDeFormulario`.
    const [delimitados, zonales] = await Promise.all([
      this.repositorio.catalogosDeFormulario(formulario.id),
      this.repositorio.zonalesDeFormulario(formulario.id),
    ]);

    return {
      ...delimitados,
      zonales,
      ...this.banderas(formulario),
    };
  }

  /**
   * PV-36. Los catálogos del formulario PARA ADMINISTRAR: incluye los desactivados, con
   * su bandera `activo`, para poder reactivarlos. El registro de operativos no usa esto
   * —usa `obtenerCatalogos`, que filtra lo vigente—; este camino es solo de P-08.
   */
  async obtenerCatalogosAdmin(
    codigo: string,
  ): Promise<CatalogosAdminDeFormulario> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);

    // Dos consultas fijas: el valor con sus usos (`_count`) y las zonales que ofrece al registrar.
    const [delimitados, zonales] = await Promise.all([
      this.repositorio.catalogosDeFormularioConInactivos(formulario.id),
      this.repositorio.zonalesDeFormulario(formulario.id),
    ]);

    const administrar = (usos: number): DatosDeAdministracion => ({
      usos,
      ...puedeEliminar({ usos }),
    });

    return {
      puntos: delimitados.puntos.map(({ _count, ...punto }) => ({
        ...punto,
        ...administrar(_count.operativos),
      })),
      tiposControl: delimitados.tiposControl.map(({ _count, ...tipo }) => ({
        ...tipo,
        // Por la columna única o por la tabla de varios tipos: basta con que alguna lo use.
        ...administrar(_count.operativos + _count.operativosMultiples),
      })),
      instituciones: delimitados.instituciones.map(
        ({ _count, ...institucion }) => ({
          ...institucion,
          ...administrar(_count.operativos),
        }),
      ),
      zonales,
      ...this.banderas(formulario),
    };
  }

  /** RN-17. Los puntos del formulario que pertenecen a SU zonal indicada. */
  async obtenerPuntos(
    codigo: string,
    zonalId: number,
  ): Promise<PuntoEncuentro[]> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    await this.exigirZonalDe(formulario, zonalId);

    return this.repositorio.puntosDeFormularioYZonal(formulario.id, zonalId);
  }

  // ─────────────────── Administración · zonales ───────────────────
  //
  // La zonal es DEL FORMULARIO desde el 2026-10-13: nombre y estado propios, una por zona de la
  // ciudad. Mismo blindaje que los otros catálogos: nombre único en el formulario, baja lógica en
  // cascada a SUS puntos, borrado solo si nunca se usó, y traza.

  /**
   * Alta de una zonal en el formulario. La ZONA DE LA CIUDAD es obligatoria —es la que Transporte
   * usa para los traslados y el sector— y el formulario no puede tenerla ya. El nombre se guarda en
   * formato título y no se repite en el formulario (sí en otros).
   */
  async crearZonal(
    codigo: string,
    datos: { zonaId: number; nombre: string },
    usuarioId: number,
  ): Promise<ZonalAdmin> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const zona = await this.repositorio.buscarZona(datos.zonaId);
    if (!zona) {
      throw new RecursoNoEncontradoError(
        `No existe la zona de la ciudad con identificador ${datos.zonaId}.`,
        { zonaId: datos.zonaId },
      );
    }
    if (!zona.activo) {
      throw new ValidacionError(
        `La zona de la ciudad «${zona.nombre}» está fuera de uso: elija otra.`,
        { zonaId: zona.id },
      );
    }

    const nombre = aFormatoTitulo(datos.nombre);
    const existentes = await this.repositorio.nombresDeZonalesDeFormulario(
      formulario.id,
    );
    const yaLaTiene = existentes.find((fila) => fila.zonaId === zona.id);
    if (yaLaTiene) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CATALOGO_DUPLICADO,
        `Este formulario ya tiene la zonal de ${zona.nombre}: «${yaLaTiene.nombre}».`,
        { zonaId: zona.id, zonalExistente: yaLaTiene.nombre },
      );
    }
    this.exigirLibre(
      nombre,
      existentes.map((fila) => fila.nombre),
      () => 'Ya existe una zonal con ese nombre en este formulario.',
    );

    const creada = await this.escribirConTraza(
      't_zonal_formulario',
      AccionAuditoria.CREAR,
      usuarioId,
      (cliente) =>
        // Toma el ORDEN de su zona: la lista sigue el orden de la ciudad en todos los formularios.
        this.repositorio.crearZonalDeFormulario(
          {
            formularioId: formulario.id,
            zonaId: zona.id,
            nombre,
            orden: zona.orden,
          },
          cliente,
        ),
    );

    return {
      ...this.comoZonalAdmin({ ...creada, zona }),
      usos: 0,
      puntos: 0,
      puntosActivos: 0,
      ...puedeEliminar({ usos: 0, puntos: 0 }),
    };
  }

  async actualizarZonal(
    codigo: string,
    zonaId: number,
    datos: { nombre?: string; activo?: boolean },
    usuarioId: number,
  ): Promise<Zonal> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const zonal = await this.exigirZonalDe(formulario, zonaId);
    const nombre =
      datos.nombre === undefined ? undefined : aFormatoTitulo(datos.nombre);

    // La zona de la ciudad NO cambia al actualizar: la llevan los puntos y los operativos. Solo
    // cambian el nombre y el estado, y solo en este formulario.
    if (nombre !== undefined && nombre !== zonal.nombre) {
      const existentes = await this.repositorio.nombresDeZonalesDeFormulario(
        formulario.id,
      );
      this.exigirLibre(
        nombre,
        existentes
          .filter((fila) => fila.id !== zonal.id)
          .map((fila) => fila.nombre),
        () => 'Ya existe una zonal con ese nombre en este formulario.',
      );
    }

    const cambios = this.auditoria.compararCambios(
      { zofo_nombre: zonal.nombre, zofo_activo: zonal.activo },
      {
        zofo_nombre: nombre ?? zonal.nombre,
        zofo_activo: datos.activo ?? zonal.activo,
      },
    );
    if (cambios.length === 0) return comoZonal(zonal);

    const actualizada = await this.escribirConTraza(
      't_zonal_formulario',
      AccionAuditoria.ACTUALIZAR,
      usuarioId,
      (cliente) =>
        this.repositorio.actualizarZonalDeFormulario(
          zonal.id,
          { nombre, activo: datos.activo },
          cliente,
        ),
      cambios,
    );
    return comoZonal({ ...actualizada, zona: zonal.zona });
  }

  /**
   * Da de baja la zonal DEL FORMULARIO Y, EN CASCADA, SUS PUNTOS VIGENTES EN ESE FORMULARIO.
   *
   * Una zonal fuera de uso no debe dejar puntos vigentes colgando: al registrar ya no se ofrece,
   * pero si se reactivara reaparecerían como si nada. Los puntos de OTROS formularios en la misma
   * zona no se tocan. Todo en una transacción (regla 5), con la traza de cada fila. Reactivar la
   * zonal NO reactiva sus puntos —cada uno pudo retirarse por su cuenta—.
   */
  async desactivarZonal(
    codigo: string,
    zonaId: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<Zonal>> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const zonal = await this.exigirZonalDe(formulario, zonaId);
    const usos = await this.repositorio.contarOperativosDeFormularioConZona(
      formulario.id,
      zonaId,
    );

    // Una baja repetida no escribe ni audita: la traza diría que no cambió nada.
    if (!zonal.activo) {
      return {
        registro: comoZonal(zonal),
        usosHistoricos: usos,
        mensaje: `${zonal.nombre} ya estaba fuera de uso. No se modificó nada.`,
      };
    }

    const puntos = await this.repositorio.puntosActivosDeZonalDeFormulario(
      formulario.id,
      zonaId,
    );

    const desactivada = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const fila = await this.repositorio.actualizarZonalDeFormulario(
          zonal.id,
          { activo: false },
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_zonal_formulario',
            entidadId: zonal.id,
            accion: AccionAuditoria.ELIMINAR,
            cambios: [
              {
                campo: 'zofo_activo',
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
      registro: comoZonal({ ...desactivada, zona: zonal.zona }),
      usosHistoricos: usos,
      mensaje: this.mensajeDeBaja(zonal.nombre, usos) + cascada,
    };
  }

  // ─────────────────── Administración · puntos ───────────────────

  /** Alta de un punto en una zonal VIGENTE del formulario. */
  async crearPunto(
    codigo: string,
    datos: { nombre: string; zonalId: number },
    usuarioId: number,
  ): Promise<PuntoEncuentro> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const nombre = datos.nombre.trim();
    const zonal = await this.exigirZonalVigenteDe(formulario, datos.zonalId);

    await this.exigirPuntoLibre(formulario.id, zonal, nombre);

    return this.escribirConTraza(
      't_punto_encuentro',
      AccionAuditoria.CREAR,
      usuarioId,
      (cliente) =>
        this.repositorio.crearPunto(
          { nombre, zonalId: datos.zonalId, formularioId: formulario.id },
          cliente,
        ),
    );
  }

  /**
   * VALIDA un punto NUEVO que se va a crear al REGISTRAR un operativo (Unidad de Operativos,
   * 2026-09-24), ANTES de abrir la transacción del registro. Comprueba lo que no depende de
   * escribir: que el formulario lo permita (`puntoManual`, hoy los de Unidad de Operativos 1-4),
   * que la zonal sea una vigente DEL formulario y que el nombre esté libre en ella. Devuelve el
   * nombre ya recortado.
   *
   * NO crea nada: el punto se escribe con `crearPuntoEnTransaccion`, DENTRO de la transacción del
   * operativo, para que entren juntos o no entre ninguno (regla 5).
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

    const zonal = await this.exigirZonalVigenteDe(formulario, datos.zonalId);

    const nombre = datos.nombre.trim();
    await this.exigirPuntoLibre(formulario.id, zonal, nombre);

    return nombre;
  }

  /**
   * CREA el punto NUEVO del registro DENTRO de una transacción ajena (la del operativo), con el
   * `cliente` recibido: lo inserta en ESTE formulario y deja su traza, todo en esa misma
   * transacción. Lo que valida ya se comprobó en `validarPuntoDeRegistro`; aquí solo se escribe.
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
    codigo: string,
    id: number,
    datos: {
      nombre?: string;
      zonalId?: number;
      activo?: boolean;
    },
    usuarioId: number,
  ): Promise<PuntoEncuentro> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const punto = await this.exigirPuntoDe(formulario, id);
    const nombre = datos.nombre?.trim();
    const zonalId = datos.zonalId ?? punto.zonalId;

    // Mover un punto a OTRA zonal exige que sea una vigente DE SU formulario: una desactivada no
    // se ofrece al registrar, y el punto quedaría colgando de ella. Quedarse en la suya —aunque
    // esté desactivada— sigue permitido: renombrar no cambia nada de eso.
    const zonal =
      zonalId !== punto.zonalId
        ? await this.exigirZonalVigenteDe(formulario, zonalId)
        : await this.exigirZonalDe(formulario, zonalId);

    // UN PUNTO NO SE REACTIVA BAJO UNA ZONAL INACTIVA. Primero se reactiva la zonal —y desde
    // entonces sus puntos se reactivan uno a uno—. Se comprueba solo al REACTIVAR.
    if (datos.activo === true && !punto.activo && !zonal.activo) {
      throw new ValidacionError(
        `«${punto.nombre}» pertenece a una zonal desactivada. Reactive primero la zonal «${zonal.nombre}» para poder reactivar sus puntos.`,
        { puntoId: id, zonalId },
      );
    }

    // La comprobación se hace si cambia el nombre O LA ZONAL: `uq_punto_form_zona_nombre` es
    // compuesto, y mover el punto a una zonal donde ya existe ese nombre lo infringe igual.
    const cambiaDenominacion = nombre !== undefined && nombre !== punto.nombre;
    const cambiaZonal = zonalId !== punto.zonalId;

    if (cambiaDenominacion || cambiaZonal) {
      await this.exigirPuntoLibre(
        formulario.id,
        zonal,
        nombre ?? punto.nombre,
        id,
      );
    }

    // Las claves son NOMBRES DE COLUMNA, no propiedades del modelo: la traza la lee
    // quien investiga un cambio en la base.
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
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<PuntoEncuentro>> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.darDeBaja(usuarioId, {
      entidad: 't_punto_encuentro',
      campoActivo: 'pcto_activo',
      buscar: () => this.exigirPuntoDe(formulario, id),
      denominacion: (punto) => punto.nombre,
      contarUsos: () => this.repositorio.contarOperativosConPunto(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarPunto(id, { activo: false }, cliente),
    });
  }

  // ───────────── Administración · tipos de control ─────────────

  async crearTipoControl(
    codigo: string,
    datos: { nombre: string },
    usuarioId: number,
  ): Promise<TipoControl> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    // Se guarda en MAYÚSCULAS (2026-10-13), escriba como escriba quien lo da de alta.
    const nombre = enMayusculas(datos.nombre);

    await this.exigirTipoLibre(formulario.id, nombre);

    return this.escribirConTraza(
      't_tipo_control',
      AccionAuditoria.CREAR,
      usuarioId,
      (cliente) =>
        this.repositorio.crearTipoControl(nombre, formulario.id, cliente),
    );
  }

  async actualizarTipoControl(
    codigo: string,
    id: number,
    datos: { nombre?: string; activo?: boolean },
    usuarioId: number,
  ): Promise<TipoControl> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const tipo = await this.exigirTipoControlDe(formulario, id);
    const nombre =
      datos.nombre === undefined ? undefined : enMayusculas(datos.nombre);

    if (nombre !== undefined && nombre !== tipo.nombre) {
      // El nombre es único DENTRO del formulario del tipo, no en todo el catálogo.
      await this.exigirTipoLibre(formulario.id, nombre, id);
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
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<TipoControl>> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.darDeBaja(usuarioId, {
      entidad: 't_tipo_control',
      campoActivo: 'tico_activo',
      buscar: () => this.exigirTipoControlDe(formulario, id),
      denominacion: (tipo) => tipo.nombre,
      contarUsos: () => this.repositorio.contarOperativosConTipoControl(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarTipoControl(id, { activo: false }, cliente),
    });
  }

  // ─────────────── Administración · instituciones ───────────────

  async crearInstitucion(
    codigo: string,
    datos: { sigla: string; nombre: string },
    usuarioId: number,
  ): Promise<Institucion> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const sigla = datos.sigla.trim();
    const nombre = datos.nombre.trim();

    await this.exigirInstitucionLibre(formulario.id, { sigla, nombre });

    return this.escribirConTraza(
      't_institucion',
      AccionAuditoria.CREAR,
      usuarioId,
      (cliente) =>
        this.repositorio.crearInstitucion(
          { sigla, nombre, formularioId: formulario.id },
          cliente,
        ),
    );
  }

  async actualizarInstitucion(
    codigo: string,
    id: number,
    datos: {
      sigla?: string;
      nombre?: string;
      activo?: boolean;
    },
    usuarioId: number,
  ): Promise<Institucion> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const institucion = await this.exigirInstitucionDe(formulario, id);
    const sigla = datos.sigla?.trim();
    const nombre = datos.nombre?.trim();

    // Sigla y denominación son únicas por formulario: se compara solo con las del mismo, y solo
    // lo que cambia.
    const cambiaSigla = sigla !== undefined && sigla !== institucion.sigla;
    const cambiaNombre = nombre !== undefined && nombre !== institucion.nombre;
    if (cambiaSigla || cambiaNombre) {
      await this.exigirInstitucionLibre(
        formulario.id,
        {
          sigla: cambiaSigla ? sigla : undefined,
          nombre: cambiaNombre ? nombre : undefined,
        },
        id,
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
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBaja<Institucion>> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.darDeBaja(usuarioId, {
      entidad: 't_institucion',
      campoActivo: 'inst_activo',
      buscar: () => this.exigirInstitucionDe(formulario, id),
      denominacion: (institucion) => institucion.sigla,
      contarUsos: () => this.repositorio.contarOperativosConInstitucion(id),
      desactivar: (cliente) =>
        this.repositorio.actualizarInstitucion(id, { activo: false }, cliente),
    });
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /** Las banderas del formulario que viajan con sus catálogos. */
  private banderas(formulario: FormularioConAreas) {
    return {
      capturaLibrePunto: formulario.capturaLibrePunto,
      capturaLibreTipo: formulario.capturaLibreTipo,
      tipoControlMultiple: formulario.tipoControlMultiple,
      variosPorPersona: formulario.variosPorPersona,
      cantidadPorPersona: formulario.cantidadPorPersona,
      puntoManual: formulario.puntoManual,
      tipoTransportePorDefecto: formulario.tipoTransporteDefecto,
    };
  }

  private comoZonalAdmin(
    fila: ZonalFormulario & { zona: Zonal },
  ): Zonal & { zonalFormularioId: number } {
    return { ...comoZonal(fila), zonalFormularioId: fila.id };
  }

  /**
   * Escribe y audita en la misma transacción (DA-09).
   *
   * Concentra aquí lo que las operaciones de administración comparten: abrir la transacción,
   * dejar la traza con el identificador que la operación produjo —que en un alta solo se conoce
   * después de insertar— y devolver la fila.
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
      return `${denominacion} se retiró del catálogo y ya no se ofrecerá al registrar. Como nunca se usó en un cuadro, también puede eliminarlo definitivamente.`;
    }
    return `${denominacion} se retiró del catálogo y ya no se ofrecerá al registrar. No se elimina porque está registrado en ${usos} operativo${usos === 1 ? '' : 's'} anterior${usos === 1 ? '' : 'es'}.`;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * BAJA FÍSICA (ELIMINAR), y SOLO para lo que NUNCA se usó EN ESE FORMULARIO.
   *
   * A diferencia de la baja lógica (desactivar), esto BORRA la fila. Decide la MISMA política
   * que la lista de administración usa para habilitar el botón (`puedeEliminar`): lo usado en un
   * cuadro y la zonal con puntos se rechazan con 409 y su motivo, y el administrador desactiva en
   * su lugar. Borrar una zonal borra SOLO la del formulario; la zona de la ciudad queda.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async eliminarZonal(
    codigo: string,
    zonaId: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    const zonal = await this.exigirZonalDe(formulario, zonaId);
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_zonal_formulario',
      buscar: () => Promise.resolve(zonal),
      denominacion: (fila: ZonalDeFormulario) => fila.nombre,
      uso: async () => {
        const [usos, puntos] = await Promise.all([
          this.repositorio.contarOperativosDeFormularioConZona(
            formulario.id,
            zonaId,
          ),
          this.repositorio.puntosPorZonaDeFormulario(formulario.id),
        ]);
        return { usos, puntos: puntos.todos.get(zonaId) ?? 0 };
      },
      eliminar: (cliente) =>
        this.repositorio.eliminarZonalDeFormulario(zonal.id, cliente),
      // La pantalla identifica la zonal por su zona: es lo que se devuelve.
      idRespuesta: zonaId,
    });
  }

  async eliminarPunto(
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_punto_encuentro',
      buscar: () => this.exigirPuntoDe(formulario, id),
      denominacion: (punto: PuntoEncuentro) => punto.nombre,
      uso: async () => ({
        usos: await this.repositorio.contarOperativosConPunto(id),
      }),
      eliminar: (cliente) => this.repositorio.eliminarPunto(id, cliente),
    });
  }

  async eliminarTipoControl(
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_tipo_control',
      buscar: () => this.exigirTipoControlDe(formulario, id),
      denominacion: (tipo: TipoControl) => tipo.nombre,
      uso: async () => ({
        usos: await this.repositorio.contarOperativosConTipoControl(id),
      }),
      eliminar: (cliente) => this.repositorio.eliminarTipoControl(id, cliente),
    });
  }

  async eliminarInstitucion(
    codigo: string,
    id: number,
    usuarioId: number,
  ): Promise<{ id: number; mensaje: string }> {
    const formulario = await this.formularios.obtenerDefinicion(codigo);
    return this.eliminarPermanente(usuarioId, {
      entidad: 't_institucion',
      buscar: () => this.exigirInstitucionDe(formulario, id),
      denominacion: (institucion: Institucion) => institucion.sigla,
      uso: async () => ({
        usos: await this.repositorio.contarOperativosConInstitucion(id),
      }),
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
      uso: () => Promise<UsoDeCatalogo>;
      eliminar: (cliente: Prisma.TransactionClient) => Promise<void>;
      idRespuesta?: number;
    },
  ): Promise<{ id: number; mensaje: string }> {
    const registro = await catalogo.buscar();
    const denominacion = catalogo.denominacion(registro);

    const uso = await catalogo.uso();
    const veredicto = puedeEliminar(uso);
    if (!veredicto.puedeEliminar) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CATALOGO_EN_USO,
        `No se puede eliminar «${denominacion}». ${veredicto.motivoNoEliminar ?? ''}`.trim(),
        { id: registro.id, ...uso },
      );
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
      id: catalogo.idRespuesta ?? registro.id,
      mensaje: `${denominacion} se eliminó definitivamente del catálogo.`,
    };
  }

  // ───────────── Duplicados: 409 con su mensaje (rediseño de P-08, 2026-10-12) ─────────────

  /**
   * Impide dos escrituras de la misma cosa EN EL MISMO FORMULARIO. La unicidad de la base distingue
   * mayúsculas y acentos, de modo que «Control de ruido» y «CONTROL DE RUIDO» convivirían como
   * filas distintas; esta comprobación sí lo impide. 409 `CATALOGO_DUPLICADO`. En formularios
   * distintos el mismo nombre está permitido: cada uno compara solo con los suyos.
   */
  private exigirLibre(
    denominacion: string,
    existentes: string[],
    mensaje: (choque: string) => string,
  ): void {
    const canonica = normalizarParaComparar(denominacion);
    const choque = existentes.find(
      (valor) => normalizarParaComparar(valor) === canonica,
    );

    if (choque) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CATALOGO_DUPLICADO,
        mensaje(choque),
        { denominacionPropuesta: denominacion, denominacionExistente: choque },
      );
    }
  }

  private async exigirPuntoLibre(
    formularioId: number,
    zonal: ZonalDeFormulario,
    nombre: string,
    excluirId?: number,
  ): Promise<void> {
    // Los puntos guardan la ZONA (zonaId), no el id de la fila de la zonal del formulario.
    const existentes = await this.repositorio.nombresDePuntosDeFormularioYZonal(
      formularioId,
      zonal.zonaId,
    );
    this.exigirLibre(
      nombre,
      existentes
        .filter((fila) => fila.id !== excluirId)
        .map((fila) => fila.nombre),
      (choque) => `Ya existe '${choque}' en ${zonal.nombre}.`,
    );
  }

  private async exigirTipoLibre(
    formularioId: number,
    nombre: string,
    excluirId?: number,
  ): Promise<void> {
    const existentes =
      await this.repositorio.nombresDeTiposControlDeFormulario(formularioId);
    this.exigirLibre(
      nombre,
      existentes
        .filter((fila) => fila.id !== excluirId)
        .map((fila) => fila.nombre),
      () => 'Ya existe un tipo de control con ese nombre en este formulario.',
    );
  }

  /** Sigla y denominación, cada una única en el formulario. Solo se comprueba lo que llega. */
  private async exigirInstitucionLibre(
    formularioId: number,
    datos: { sigla?: string; nombre?: string },
    excluirId?: number,
  ): Promise<void> {
    const existentes = (
      await this.repositorio.siglasDeInstitucionesDeFormulario(formularioId)
    ).filter((fila) => fila.id !== excluirId);

    if (datos.sigla !== undefined) {
      this.exigirLibre(
        datos.sigla,
        existentes.map((fila) => fila.sigla),
        (choque) => `Ya existe la sigla ${choque} en este formulario.`,
      );
    }
    if (datos.nombre !== undefined) {
      this.exigirLibre(
        datos.nombre,
        // Filas antiguas sin denominación no cuentan como choque.
        existentes.map((fila) => fila.nombre ?? ''),
        (choque) =>
          `Ya existe una institución con la denominación «${choque}» en este formulario.`,
      );
    }
  }

  // ─────────── Pertenencia al formulario: 404 si el valor no es suyo (2026-10-13) ───────────
  //
  // 404 y no 403: el valor de otro formulario no existe PARA ESTE. Responder 403 confirmaría que
  // el identificador existe en otra parte.

  /** La zonal del formulario para esa zona; 404 si el formulario no la tiene. */
  private async exigirZonalDe(
    formulario: FormularioConAreas,
    zonaId: number,
  ): Promise<ZonalDeFormulario> {
    const zonal = await this.repositorio.buscarZonalDeFormulario(
      formulario.id,
      zonaId,
    );
    if (!zonal) {
      throw new RecursoNoEncontradoError(
        `El formulario ${formulario.numero}. ${formulario.nombre} no tiene la zonal con identificador ${zonaId}.`,
        { zonalId: zonaId, formulario: formulario.codigo },
      );
    }
    return zonal;
  }

  /** La zonal es del formulario Y está vigente: a una desactivada no se le agregan puntos. */
  private async exigirZonalVigenteDe(
    formulario: FormularioConAreas,
    zonaId: number,
  ): Promise<ZonalDeFormulario> {
    const zonal = await this.exigirZonalDe(formulario, zonaId);
    if (!zonal.activo) {
      throw new ValidacionError(
        `La zonal «${zonal.nombre}» está desactivada: reactívela o elija otra para el punto de encuentro.`,
        { zonalId: zonaId },
      );
    }
    return zonal;
  }

  private async exigirPuntoDe(
    formulario: FormularioConAreas,
    id: number,
  ): Promise<PuntoEncuentro> {
    const punto = await this.repositorio.buscarPunto(id);
    if (!punto || punto.formularioId !== formulario.id) {
      throw new RecursoNoEncontradoError(
        `No existe el punto de encuentro con identificador ${id} en este formulario.`,
        { id, formulario: formulario.codigo },
      );
    }
    return punto;
  }

  private async exigirTipoControlDe(
    formulario: FormularioConAreas,
    id: number,
  ): Promise<TipoControl> {
    const tipo = await this.repositorio.buscarTipoControl(id);
    if (!tipo || tipo.formularioId !== formulario.id) {
      throw new RecursoNoEncontradoError(
        `No existe el tipo de control con identificador ${id} en este formulario.`,
        { id, formulario: formulario.codigo },
      );
    }
    return tipo;
  }

  private async exigirInstitucionDe(
    formulario: FormularioConAreas,
    id: number,
  ): Promise<Institucion> {
    const institucion = await this.repositorio.buscarInstitucion(id);
    if (!institucion || institucion.formularioId !== formulario.id) {
      throw new RecursoNoEncontradoError(
        `No existe la institución con identificador ${id} en este formulario.`,
        { id, formulario: formulario.codigo },
      );
    }
    return institucion;
  }
}
