/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuario-actual.decorator.ts
 * Responsabilidad: Entregar al controlador la identidad ya resuelta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Evita que cada controlador lea `request.user` a mano y lo convierta al tipo.
 *
 * @example registrar(@Body() dto: CrearOperativoDto, @UsuarioActual() usuario: UsuarioAutenticado)
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';

export const UsuarioActual = createParamDecorator(
  (
    _datos: unknown,
    contexto: ExecutionContext,
  ): UsuarioAutenticado | undefined => {
    const peticion = contexto
      .switchToHttp()
      .getRequest<Request & { user?: UsuarioAutenticado }>();
    return peticion.user;
  },
);
