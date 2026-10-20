/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios-admin.service.ts
 * Responsabilidad: Crear, editar y dar de baja formularios desde la pantalla de administración.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-29
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HASTA HOY UN FORMULARIO SOLO NACÍA POR MIGRACIÓN.
 *
 * `t_formulario` y sus satélites se sembraban en la semilla; agregar el décimo formulario
 * exigía escribir SQL y desplegar. Con el rango de `form_numero` ampliado a 1..99 (migración
 * 20260929120000), un formulario es puro dato, y este servicio es esa escritura: crea el
 * formulario con su rol dueño (una fila ESCRITURA) y su prefijo general, en una sola
 * transacción con la auditoría dentro (regla 5). Las áreas se le configuran después.
 *
 * NÚMERO Y CÓDIGO SON INMUTABLES tras el alta: los referencian los operativos y la identidad
 * legible del formulario. La edición cambia todo lo demás. La baja es SIEMPRE lógica
 * (`activo=false`): las FK de `Operativo` son RESTRICT y un formulario con historia no se borra.
 *
 * REDISEÑO DE P-09 (2026-10-13). Las áreas ya NO se escriben aquí: el formulario nace sin áreas
 * y se le configuran en Catálogos del cuadro (`AreasFormularioService`). El prefijo solo cambia
 * si es distinto y solo en su fila general; no puede repetir el de otro formulario. Número,
 * código y prefijo repetidos son 409. El nombre se guarda en MAYÚSCULAS. Las reglas puras viven
 * en `politicas/formulario-admin.ts`.
 *
 * LOS COLORES SE ELIGEN DE LA PALETA (`esColorDePaleta`), no se teclean: el manual de marca no
 * admite hexadecimales fuera de la paleta institucional.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  PoliticaVehiculo,
  TipoTransporte,
  type Prisma,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { esColorDePaleta } from '../domain/paleta-formularios';
import {
  FormulariosRepository,
  type DatosNuevoFormulario,
  type FormularioCompleto,
} from '../infrastructure/formularios.repository';
import {
  decidirCambioDePrefijo,
  mensajePrefijoRepetido,
  nombreDeFormulario,
  normalizarPrefijo,
  numeroLibreMasBajo,
  prefijoUsadoPorOtro,
} from './politicas/formulario-admin';
import {
  CrearFormularioDto,
  ActualizarFormularioDto,
} from '../presentation/dto/administrar-formularios.dto';

/** Lo que se dice tras dar de baja: que quedó inactivo y cuántos operativos conserva. */
export interface ResultadoBajaFormulario {
  usosHistoricos: number;
  mensaje: string;
}

@Injectable()
export class FormulariosAdminService {
  constructor(
    private readonly repositorio: FormulariosRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  /** Todos los formularios, incluidos los dados de baja, para la tabla de administración. */
  async listarTodos(): Promise<FormularioCompleto[]> {
    return this.repositorio.listarTodos();
  }

  /** El número libre más bajo del 1 al 99, el que la pantalla sugiere al crear (o `null`). */
  async numeroLibre(): Promise<number | null> {
    const usados = await this.repositorio.numerosYCodigosUsados();
    return numeroLibreMasBajo(usados.map((fila) => fila.numero));
  }

  /**
   * Crea el formulario con su rol dueño (ESCRITURA) y su prefijo general en una sola
   * transacción. Número, código y prefijo únicos (409); color de la paleta. Nace SIN áreas.
   */
  async crear(
    dto: CrearFormularioDto,
    usuarioId: number,
  ): Promise<FormularioCompleto> {
    const codigo = dto.codigo.trim();
    const prefijo = normalizarPrefijo(dto.prefijo);

    await this.exigirNumeroYCodigoLibres(dto.numero, codigo);
    await this.exigirPrefijoLibre(prefijo, null);
    this.exigirColorDePaleta(dto.colorFondo, dto.colorAcento, dto.colorNombre);

    const datos: DatosNuevoFormulario = {
      numero: dto.numero,
      codigo,
      nombre: nombreDeFormulario(dto.nombre),
      colorFondo: dto.colorFondo.toUpperCase(),
      colorAcento: dto.colorAcento.toUpperCase(),
      colorNombre: dto.colorNombre.trim(),
      rolDueno: dto.rolDueno,
      politicaVehiculo: dto.politicaVehiculo ?? PoliticaVehiculo.CONDICIONAL,
      // Transporte requerido (2026-10-07): un formulario nuevo sugiere PROPIOS_MEDIOS salvo que el
      // administrador configure otro. Es solo la sugerencia del combo; quien registra decide.
      tipoTransporteDefecto:
        dto.tipoTransportePorDefecto ?? TipoTransporte.PROPIOS_MEDIOS,
      condicionanteNoct: dto.condicionanteNoct ?? false,
      esPatrulla: dto.esPatrulla ?? false,
      capturaLibrePunto: dto.capturaLibrePunto ?? false,
      capturaLibreTipo: dto.capturaLibreTipo ?? false,
      puntoManual: dto.puntoManual ?? false,
      filtraPersonalPorRol: dto.filtraPersonalPorRol ?? true,
      tipoControlMultiple: dto.tipoControlMultiple ?? false,
      variosPorPersona: dto.variosPorPersona ?? false,
      cantidadPorPersona: dto.cantidadPorPersona ?? false,
      orden: dto.orden ?? dto.numero,
    };

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const formulario = await this.repositorio.crearFormulario(datos, cliente);
      await this.repositorio.sincronizarRolDueno(
        formulario.id,
        dto.rolDueno,
        cliente,
      );
      await this.repositorio.crearPrefijoGeneral(
        formulario.id,
        prefijo,
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_formulario',
          entidadId: formulario.id,
          accion: AccionAuditoria.CREAR,
          cambios: [
            {
              campo: 'form_numero',
              valorAnterior: '',
              valorNuevo: String(datos.numero),
            },
            {
              campo: 'form_codigo',
              valorAnterior: '',
              valorNuevo: datos.codigo,
            },
            {
              campo: 'form_nombre',
              valorAnterior: '',
              valorNuevo: datos.nombre,
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
    });

    this.logger.log('Formulario creado', {
      codigo: datos.codigo,
      numero: datos.numero,
    });

    return this.exigirFormulario(codigo);
  }

  /**
   * Edita un formulario. Número, código y áreas no llegan (el DTO los rechaza con 400). El
   * resto —nombre, colores de paleta, política, banderas, orden, activo, rol dueño y prefijo
   * general— se aplica en una transacción. Guardar sin cambios no escribe nada.
   */
  async actualizar(
    codigo: string,
    dto: ActualizarFormularioDto,
    usuarioId: number,
  ): Promise<FormularioCompleto> {
    const formulario = await this.exigirFormulario(codigo);

    if (
      dto.colorFondo !== undefined ||
      dto.colorAcento !== undefined ||
      dto.colorNombre !== undefined
    ) {
      if (
        dto.colorFondo === undefined ||
        dto.colorAcento === undefined ||
        dto.colorNombre === undefined
      ) {
        throw new ValidacionError(
          'Para cambiar el color elija uno de la paleta: fondo, acento y nombre van juntos.',
          { codigo },
        );
      }
      this.exigirColorDePaleta(
        dto.colorFondo,
        dto.colorAcento,
        dto.colorNombre,
      );
    }

    const prefijo = decidirCambioDePrefijo(formulario.prefijos, dto.prefijo);
    if (prefijo.accion === 'rechazar') {
      throw new ValidacionError(prefijo.mensaje, { codigo });
    }
    if (prefijo.accion === 'actualizar') {
      await this.exigirPrefijoLibre(prefijo.prefijo, formulario.id);
    }

    const data: Prisma.FormularioUncheckedUpdateInput = {};
    const cambios: {
      campo: string;
      valorAnterior: string;
      valorNuevo: string;
    }[] = [];

    const texto = (
      valor: string | undefined,
      actual: string,
      columna: string,
      set: () => void,
    ): void => {
      if (valor === undefined) return;
      const limpio = valor.trim();
      if (limpio !== actual) {
        cambios.push({
          campo: columna,
          valorAnterior: actual,
          valorNuevo: limpio,
        });
      }
      set();
    };

    const bandera = (
      valor: boolean | undefined,
      actual: boolean,
      columna: string,
      set: () => void,
    ): void => {
      if (valor === undefined) return;
      if (valor !== actual) {
        cambios.push({
          campo: columna,
          valorAnterior: String(actual),
          valorNuevo: String(valor),
        });
      }
      set();
    };

    const nombre =
      dto.nombre === undefined ? undefined : nombreDeFormulario(dto.nombre);
    texto(nombre, formulario.nombre, 'form_nombre', () => {
      data.nombre = nombre;
    });
    if (dto.colorFondo !== undefined) {
      data.colorFondo = dto.colorFondo.toUpperCase();
      data.colorAcento = dto.colorAcento?.toUpperCase();
      data.colorNombre = dto.colorNombre?.trim();
      if (dto.colorNombre?.trim() !== formulario.colorNombre) {
        cambios.push({
          campo: 'form_color_nombre',
          valorAnterior: formulario.colorNombre,
          valorNuevo: dto.colorNombre?.trim() ?? '',
        });
      }
    }
    if (dto.rolDueno !== undefined && dto.rolDueno !== formulario.rolDueno) {
      data.rolDueno = dto.rolDueno;
      cambios.push({
        campo: 'form_rol_dueno',
        valorAnterior: formulario.rolDueno,
        valorNuevo: dto.rolDueno,
      });
    }
    if (
      dto.politicaVehiculo !== undefined &&
      dto.politicaVehiculo !== formulario.politicaVehiculo
    ) {
      data.politicaVehiculo = dto.politicaVehiculo;
      cambios.push({
        campo: 'form_politica_vehiculo',
        valorAnterior: formulario.politicaVehiculo,
        valorNuevo: dto.politicaVehiculo,
      });
    }
    if (
      dto.tipoTransportePorDefecto !== undefined &&
      dto.tipoTransportePorDefecto !== formulario.tipoTransporteDefecto
    ) {
      data.tipoTransporteDefecto = dto.tipoTransportePorDefecto;
      cambios.push({
        campo: 'form_tipo_transporte_defecto',
        valorAnterior: formulario.tipoTransporteDefecto,
        valorNuevo: dto.tipoTransportePorDefecto,
      });
    }
    if (dto.orden !== undefined && dto.orden !== formulario.orden) {
      data.orden = dto.orden;
      cambios.push({
        campo: 'form_orden',
        valorAnterior: String(formulario.orden),
        valorNuevo: String(dto.orden),
      });
    }
    bandera(
      dto.condicionanteNoct,
      formulario.condicionanteNoct,
      'form_condicionante_noct',
      () => {
        data.condicionanteNoct = dto.condicionanteNoct;
      },
    );
    bandera(dto.esPatrulla, formulario.esPatrulla, 'form_es_patrulla', () => {
      data.esPatrulla = dto.esPatrulla;
    });
    bandera(
      dto.capturaLibrePunto,
      formulario.capturaLibrePunto,
      'form_captura_libre_punto',
      () => {
        data.capturaLibrePunto = dto.capturaLibrePunto;
      },
    );
    bandera(
      dto.capturaLibreTipo,
      formulario.capturaLibreTipo,
      'form_captura_libre_tipo',
      () => {
        data.capturaLibreTipo = dto.capturaLibreTipo;
      },
    );
    bandera(
      dto.puntoManual,
      formulario.puntoManual,
      'form_punto_manual',
      () => {
        data.puntoManual = dto.puntoManual;
      },
    );
    bandera(
      dto.filtraPersonalPorRol,
      formulario.filtraPersonalPorRol,
      'form_filtra_personal_por_rol',
      () => {
        data.filtraPersonalPorRol = dto.filtraPersonalPorRol;
      },
    );
    bandera(
      dto.tipoControlMultiple,
      formulario.tipoControlMultiple,
      'form_tipo_control_multiple',
      () => {
        data.tipoControlMultiple = dto.tipoControlMultiple;
      },
    );
    bandera(
      dto.variosPorPersona,
      formulario.variosPorPersona,
      'form_varios_por_persona',
      () => {
        data.variosPorPersona = dto.variosPorPersona;
      },
    );
    bandera(
      dto.cantidadPorPersona,
      formulario.cantidadPorPersona,
      'form_cantidad_por_persona',
      () => {
        data.cantidadPorPersona = dto.cantidadPorPersona;
      },
    );
    bandera(dto.activo, formulario.activo, 'form_activo', () => {
      data.activo = dto.activo;
    });
    if (prefijo.accion === 'actualizar') {
      const anterior =
        formulario.prefijos.find((fila) => fila.id === prefijo.id)?.prefijo ??
        '';
      cambios.push({
        campo: 'fpre_prefijo',
        valorAnterior: anterior,
        valorNuevo: prefijo.prefijo,
      });
    }

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      if (Object.keys(data).length > 0) {
        await this.repositorio.actualizarFormulario(
          formulario.id,
          data,
          cliente,
        );
      }
      if (dto.rolDueno !== undefined && dto.rolDueno !== formulario.rolDueno) {
        await this.repositorio.sincronizarRolDueno(
          formulario.id,
          dto.rolDueno,
          cliente,
        );
      }
      if (prefijo.accion === 'actualizar') {
        await this.repositorio.actualizarPrefijo(
          prefijo.id,
          prefijo.prefijo,
          cliente,
        );
      }
      if (cambios.length > 0) {
        await this.auditoria.registrar(
          {
            entidad: 't_formulario',
            entidadId: formulario.id,
            accion: AccionAuditoria.ACTUALIZAR,
            cambios,
            usuario: usuarioId,
          },
          cliente,
        );
      }
    });

    this.logger.log('Formulario actualizado', { codigo: formulario.codigo });
    return this.exigirFormulario(codigo);
  }

  /**
   * Da de baja el formulario (`activo=false`). Nunca física: las FK de `Operativo` son
   * RESTRICT y un formulario con historia se conserva. Idempotente: si ya está inactivo no
   * escribe. Devuelve cuántos operativos históricos conserva, para el aviso.
   */
  async darDeBaja(
    codigo: string,
    usuarioId: number,
  ): Promise<ResultadoBajaFormulario> {
    const formulario = await this.exigirFormulario(codigo);
    const usos = await this.repositorio.contarOperativos(formulario.id);

    if (formulario.activo) {
      await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
        await this.repositorio.actualizarFormulario(
          formulario.id,
          { activo: false },
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_formulario',
            entidadId: formulario.id,
            accion: AccionAuditoria.ELIMINAR,
            cambios: [
              {
                campo: 'form_activo',
                valorAnterior: 'true',
                valorNuevo: 'false',
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );
      });
      this.logger.log('Formulario dado de baja', { codigo: formulario.codigo });
    }

    const mensaje =
      usos > 0
        ? `El formulario ${formulario.nombre} quedó inactivo. Sus ${usos} operativo(s) históricos se conservan.`
        : `El formulario ${formulario.nombre} quedó inactivo.`;

    return { usosHistoricos: usos, mensaje };
  }

  // ─────────────────────────── Puertas ───────────────────────────

  private exigirColorDePaleta(
    fondo: string,
    acento: string,
    nombre: string,
  ): void {
    if (esColorDePaleta(fondo, acento, nombre)) return;

    throw new ValidacionError(
      `El color «${nombre.trim()}» no está en la paleta institucional. Elija uno de la lista.`,
      { colorFondo: fondo, colorNombre: nombre },
    );
  }

  private async exigirNumeroYCodigoLibres(
    numero: number,
    codigo: string,
  ): Promise<void> {
    const usados = await this.repositorio.numerosYCodigosUsados();

    if (usados.some((fila) => fila.numero === numero)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.FORMULARIO_DUPLICADO,
        `Ya existe un formulario con el número ${numero}.`,
        { numero },
      );
    }

    const codigoNormalizado = codigo.toUpperCase();
    if (
      usados.some((fila) => fila.codigo.toUpperCase() === codigoNormalizado)
    ) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.FORMULARIO_DUPLICADO,
        `Ya existe un formulario con el código ${codigo}.`,
        { codigo },
      );
    }
  }

  /** 409 si el prefijo ya lo usa otro formulario (`formularioId` es `null` en un alta). */
  private async exigirPrefijoLibre(
    prefijo: string,
    formularioId: number | null,
  ): Promise<void> {
    const enUso = await this.repositorio.prefijosEnUso();
    if (!prefijoUsadoPorOtro(prefijo, formularioId, enUso)) return;

    throw new ReglaNegocioError(
      CODIGOS_ERROR.FORMULARIO_DUPLICADO,
      mensajePrefijoRepetido(prefijo),
      { prefijo },
    );
  }

  private async exigirFormulario(codigo: string): Promise<FormularioCompleto> {
    const formulario =
      await this.repositorio.buscarPorCodigoIncluidosInactivos(codigo);

    if (!formulario) {
      throw new RecursoNoEncontradoError(
        `No existe un formulario con el código ${codigo}.`,
        { codigo },
      );
    }

    return formulario;
  }
}
