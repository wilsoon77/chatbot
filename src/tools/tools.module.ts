import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module.js';
import { ToolsRegistry } from './tools.registry.js';
import {
  BuscarProductosTool,
  VerStockTool,
  ObtenerCategoriasTool,
  AgregarAlCarritoTool,
} from './woocommerce/woocommerce.tool.js';
import { ClarificationTool } from './general/clarification.tool.js';

@Module({
  imports: [CommerceModule],
  providers: [
    BuscarProductosTool,
    VerStockTool,
    ObtenerCategoriasTool,
    AgregarAlCarritoTool,
    ClarificationTool,
    ToolsRegistry,
  ],
  exports: [ToolsRegistry],
})
export class ToolsModule {}