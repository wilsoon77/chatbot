import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module.js'; // Importamos el CryptoModule para poder usar el CryptoService en los tools que lo requieran
import { ToolsRegistry } from './tools.registry.js';
import {
  WooCommerceClient,
  BuscarProductosTool,
  VerStockTool,
  VerEstadoPedidoTool,
  ObtenerCategoriasTool,
  AgregarAlCarritoTool,
} from './woocommerce/woocommerce.tool.js';
import { ClarificationTool } from './general/clarification.tool.js';

@Module({
  imports: [CryptoModule], // Importamos el CryptoModule para poder usar el CryptoService en los tools que lo requieran
  providers: [
    WooCommerceClient,
    BuscarProductosTool,
    VerStockTool,
    VerEstadoPedidoTool,
    ObtenerCategoriasTool,
    AgregarAlCarritoTool,
    ClarificationTool,
    ToolsRegistry,
  ],
  exports: [ToolsRegistry],
})
export class ToolsModule {}