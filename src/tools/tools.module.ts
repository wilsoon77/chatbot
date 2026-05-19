import { Module } from '@nestjs/common';
import { ToolsRegistry } from './tools.registry.js';
import {
  WooCommerceClient,
  BuscarProductosTool,
} from './woocommerce/woocommerce.tool.js';

@Module({
  providers: [WooCommerceClient, BuscarProductosTool, ToolsRegistry],
  exports: [ToolsRegistry],
})
export class ToolsModule {}
