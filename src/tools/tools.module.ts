import { Module } from '@nestjs/common';
import { ToolsRegistry } from './tools.registry.js';
import {
  WooCommerceClient,
  BuscarProductosTool,
  VerStockTool,
  VerEstadoPedidoTool,
  ObtenerCategoriasTool,
  AgregarAlCarritoTool,
} from './woocommerce/woocommerce.tool.js';

@Module({
  providers: [
    WooCommerceClient,
    BuscarProductosTool,
    VerStockTool,
    VerEstadoPedidoTool,
    ObtenerCategoriasTool,
    AgregarAlCarritoTool,
    ToolsRegistry,
  ],
  exports: [ToolsRegistry],
})
export class ToolsModule {}
